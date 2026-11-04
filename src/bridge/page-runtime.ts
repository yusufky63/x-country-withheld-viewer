import { ResponseRewriter, type RewriteDeps } from "../core/rewrite";
import type { AppliedMark, FailedMark, ProfileMark } from "../core/types";
import { installFetchHook, installXhrHook, parseGraphqlRequest, type BodyRewriter } from "./hooks";
import { isEnabledResult, isPostsPage, isProfileResult, isRecoveryResults, type PageRequest } from "./message-schema";

// X's response waits on this budget, so a slow source cannot stall the page for long.
// The source keeps going and its result is cached, so the next load of the post is instant.
export const RECOVERY_BUDGET_MS = 4_000;
const RESUME_KEY = "xcwv:resume";
const RESUME_LANDING_PATH = "/explore";
const RESUME_NAVIGATION_DELAY_MS = 600;
// A signed-in page hydrates more slowly than a signed-out one, so the check repeats.
const SERVER_RENDER_CHECK_DELAYS_MS = [800, 2_000, 4_000];

const NOTICE_CHECK_DELAY_MS = 500;
const RECENT_OPERATIONS = 15;

const POST_OPERATIONS = ["TweetDetail", "TweetResultByRestId"];
const PROFILE_OPERATIONS = ["UserByScreenName"];

const ACTIVE_KEY = Symbol.for("xcwv.active");

/** What differs between the extension and the userscript, seen from the page. */
export interface PageHost {
  /** Names this build in the console and diagnostics, so a report says what ran. */
  build: string;
  ask(request: PageRequest): Promise<unknown>;
  tell(request: PageRequest): void;
  mark(applied: AppliedMark[], failed: FailedMark[], profiles: ProfileMark[]): void;
}

/**
 * The extension and the userscript can be installed side by side. Two copies would wrap
 * fetch and XHR twice and ask the sources twice, so whichever loads first keeps the page.
 */
export function claimPage(win: Window, build: string): boolean {
  const holder = win as unknown as Record<symbol, string | undefined>;
  const active = holder[ACTIVE_KEY];
  if (active) {
    console.info(`[X Withheld Viewer] ${build} stays off, ${active} already runs on this page`);
    return false;
  }
  holder[ACTIVE_KEY] = build;
  return true;
}

/** `win` is the page's own window, which a userscript sandbox's `window` is not. */
export function startPageRuntime(win: Window & typeof globalThis, host: PageHost): void {
  /** Everything goes to the diagnostics. The console only hears about what mattered. */
  function log(line: string, notable = true): void {
    const entry = `${win.location.pathname.slice(0, 60)} ${line}`.slice(0, 400);
    if (notable) console.info(`[X Withheld Viewer] ${entry}`);
    host.tell({ type: "log", line: entry });
  }

  function ask<T>(request: PageRequest, isValid: (value: unknown) => value is T, fallback: T): Promise<T> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), RECOVERY_BUDGET_MS);
      const finish = (response: unknown) => {
        clearTimeout(timer);
        resolve(isValid(response) ? response : fallback);
      };
      host.ask(request).then(finish, () => finish(null));
    });
  }

  const deps: RewriteDeps = {
    recover: (items) =>
      ask({ type: "recover", items }, isRecoveryResults, items.map(({ id }) => ({ id, status: "provider_unavailable" }))),
    recoverProfile: (user) => ask({ type: "recover-profile", user }, isProfileResult, { status: "provider_unavailable" }),
    userPosts: (request) => ask({ type: "user-posts", request }, isPostsPage, { status: "provider_unavailable", posts: [] }),
    conversation: (request) => ask({ type: "conversation", request }, isPostsPage, { status: "provider_unavailable", posts: [] }),
    repostLabel: (name) => (win.document.documentElement.lang.startsWith("tr") ? `${name} yeniden gönderdi` : `${name} reposted`),
  };

  const rewriter = new ResponseRewriter(deps);
  const seenOperations = new Set<string>();
  const recentOperations: string[] = [];
  let watchingForNotice = false;

  /**
   * If something still brings the withheld page back after a recovery, this names what X
   * asked for just before it, which is the evidence needed to fix it from a remote report.
   */
  function watchForReturningNotice(): void {
    if (watchingForNotice) return;
    watchingForNotice = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (win.document.querySelector('main a[href*="withheld"]') === null) return;
        observer.disconnect();
        log(`notice came back after: ${recentOperations.join(" ")}`);
      }, NOTICE_CHECK_DELAY_MS);
    });
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
  }

  const bodyRewriter: BodyRewriter = {
    takesOverErrors: (ctx) => rewriter.takesOverErrors(ctx),
    watchesRestUsers: () => rewriter.watchesRestUsers(),
    async rewrite(text, ctx) {
      seenOperations.add(ctx.operation);
      recentOperations.push(ctx.operation);
      recentOperations.splice(0, Math.max(0, recentOperations.length - RECENT_OPERATIONS));
      const { text: next, applied, failed, profiles, diagnostic } = await rewriter.rewrite(text, ctx);
      if (applied.length > 0 || failed.length > 0 || profiles.length > 0) host.mark(applied, failed, profiles);
      if (profiles.length > 0) watchForReturningNotice();
      if (diagnostic) log(diagnostic, applied.length > 0 || failed.length > 0 || profiles.length > 0 || /blocked=[1-9]|copies=[1-9]/.test(diagnostic));
      return next;
    },
  };

  installFetchHook(win, bodyRewriter);
  installXhrHook(win, bodyRewriter);
  const hooksInstalledAt = win.performance.now();
  // Shows in the console whether this is running on the page, and which build.
  log(`active ${host.build}`);

  /** What X asked for before the hooks existed, since a manager can start a script late. */
  function operationsBeforeHooks(): string[] {
    const entries = win.performance.getEntriesByType("resource").filter(({ startTime }) => startTime < hooksInstalledAt);
    return entries.flatMap(({ name }) => parseGraphqlRequest(name, null, win.location.href)?.operation ?? []);
  }

  function storageGet(key: string): string | null {
    try {
      return win.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function clientNavigate(path: string): void {
    win.history.pushState({}, "", path);
    win.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }

  const sawAny = (operations: string[]) => operations.some((operation) => seenOperations.has(operation));

  /** True when X shows a withheld page that this page's requests never passed through the hook. */
  function isWithheldPageOutsideHooks(): boolean {
    const navigation = win.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const noticeShown = win.document.querySelector('main a[href*="withheld"]') !== null;
    if (/^\/[^/]+\/status\/\d+/.test(win.location.pathname)) {
      if (sawAny(POST_OPERATIONS)) return false;
      return navigation?.responseStatus === 404 || (noticeShown && operationsBeforeHooks().some((operation) => POST_OPERATIONS.includes(operation)));
    }
    if (/^\/[A-Za-z0-9_]{1,50}\/?$/.test(win.location.pathname)) {
      return noticeShown && !sawAny(PROFILE_OPERATIONS);
    }
    return false;
  }

  /**
   * The Relay client can answer a direct load of a withheld post or profile from the
   * server, and a userscript can start after X's first request, and neither leaves a
   * GraphQL response to rewrite. Revisiting the same route reuses that result. Client
   * navigation from any other page does fetch, so such a page takes one hop through a
   * neutral page and comes back. The stored path makes this a single attempt, so a page a
   * source cannot help with never loops.
   */
  function recoverOutsideHooks(): void {
    const resumePath = storageGet(RESUME_KEY);
    if (resumePath) {
      win.sessionStorage.removeItem(RESUME_KEY);
      log(`resume ${resumePath}`);
      if (resumePath.startsWith("/")) setTimeout(() => clientNavigate(resumePath), RESUME_NAVIGATION_DELAY_MS);
      return;
    }
    const startPath = win.location.pathname;
    let checkingSwitch = false;
    let reportedMissed = false;
    for (const delay of SERVER_RENDER_CHECK_DELAYS_MS) {
      setTimeout(() => {
        const missed = operationsBeforeHooks();
        if (!reportedMissed && missed.length > 0) {
          reportedMissed = true;
          log(`started after X's requests: ${[...new Set(missed)].join(" ")}`);
        }
        if (checkingSwitch || win.location.pathname !== startPath || storageGet(RESUME_KEY) || !isWithheldPageOutsideHooks()) return;
        checkingSwitch = true;
        // While switched off, X's page must stay exactly as X sent it.
        void ask({ type: "is-enabled" }, isEnabledResult, { enabled: false }).then(({ enabled }) => {
          if (!enabled) return;
          log("hop: X's request for this withheld page was not seen");
          try {
            win.sessionStorage.setItem(RESUME_KEY, win.location.pathname);
            win.location.replace(RESUME_LANDING_PATH);
          } catch {
            // Storage is blocked, so the single-attempt guard cannot hold. Leave X's page as it is.
          }
        });
      }, delay);
    }
  }

  // A manager may start a script after the page has loaded, and then this event never comes.
  if (win.document.readyState === "complete") recoverOutsideHooks();
  else win.addEventListener("load", recoverOutsideHooks, { once: true });
}
