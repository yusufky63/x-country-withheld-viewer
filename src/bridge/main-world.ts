import { ResponseRewriter, type RewriteDeps } from "../core/rewrite";
import { installFetchHook, installXhrHook, type BodyRewriter } from "./hooks";
import {
  CHANNEL,
  isEnabledResult,
  isPostsPage,
  isProfileResult,
  isRecoveryResults,
  isResponseMessage,
  type MarksMessage,
  type PageRequest,
  type RequestMessage,
} from "./message-schema";

declare const __EXTENSION_VERSION__: string;

// X's response waits on this budget, so a slow source cannot stall the page for long.
// The background keeps going and caches, so the next load of the post is instant.
const RECOVERY_BUDGET_MS = 4_000;
const RESUME_KEY = "xcwv:resume";
const RESUME_LANDING_PATH = "/explore";
const RESUME_NAVIGATION_DELAY_MS = 600;
// A signed-in page hydrates more slowly than a signed-out one, so the check repeats.
const SERVER_RENDER_CHECK_DELAYS_MS = [800, 2_000, 4_000];

const POST_OPERATIONS = ["TweetDetail", "TweetResultByRestId"];
const PROFILE_OPERATIONS = ["UserByScreenName"];

const pending = new Map<string, (response: unknown) => void>();

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (isResponseMessage(event.data)) pending.get(event.data.requestId)?.(event.data.response);
});

function send(request: PageRequest, requestId: string = crypto.randomUUID()): void {
  window.postMessage(
    { channel: CHANNEL, direction: "to-content", type: "request", requestId, request } satisfies RequestMessage,
    location.origin,
  );
}

/** Everything goes to the popup's diagnostics. The console only hears about what mattered. */
function log(line: string, notable = true): void {
  const entry = `${location.pathname.slice(0, 60)} ${line}`.slice(0, 400);
  if (notable) console.info(`[X Withheld Viewer] ${entry}`);
  send({ type: "log", line: entry });
}

function ask<T>(request: PageRequest, isValid: (value: unknown) => value is T, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const finish = (response: unknown) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(isValid(response) ? response : fallback);
    };
    const timer = setTimeout(() => finish(null), RECOVERY_BUDGET_MS);
    pending.set(requestId, finish);
    send(request, requestId);
  });
}

const deps: RewriteDeps = {
  recover: (items) =>
    ask({ type: "recover", items }, isRecoveryResults, items.map(({ id }) => ({ id, status: "provider_unavailable" }))),
  recoverProfile: (user) => ask({ type: "recover-profile", user }, isProfileResult, { status: "provider_unavailable" }),
  userPosts: (request) => ask({ type: "user-posts", request }, isPostsPage, { status: "provider_unavailable", posts: [] }),
  conversation: (request) => ask({ type: "conversation", request }, isPostsPage, { status: "provider_unavailable", posts: [] }),
  repostLabel: (name) => (document.documentElement.lang.startsWith("tr") ? `${name} yeniden gönderdi` : `${name} reposted`),
};

const rewriter = new ResponseRewriter(deps);
const seenOperations = new Set<string>();

const bodyRewriter: BodyRewriter = {
  takesOverErrors: (ctx) => rewriter.takesOverErrors(ctx),
  async rewrite(text, ctx) {
    seenOperations.add(ctx.operation);
    const { text: next, applied, failed, profiles, diagnostic } = await rewriter.rewrite(text, ctx);
    if (applied.length > 0 || failed.length > 0 || profiles.length > 0) {
      window.postMessage(
        { channel: CHANNEL, direction: "to-content", type: "marks", applied, failed, profiles } satisfies MarksMessage,
        location.origin,
      );
    }
    if (diagnostic) log(diagnostic, applied.length > 0 || failed.length > 0 || profiles.length > 0 || /blocked=[1-9]/.test(diagnostic));
    return next;
  },
};

installFetchHook(window, bodyRewriter);
installXhrHook(window, bodyRewriter);
// Shows in the console whether the extension is running on this page, and which build.
log(`active ${__EXTENSION_VERSION__}`);

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clientNavigate(path: string): void {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
}

const sawAny = (operations: string[]) => operations.some((operation) => seenOperations.has(operation));

/** True when X shows a withheld page that this page's requests never passed through the hook. */
function isServerRenderedWithheldPage(): boolean {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (/^\/[^/]+\/status\/\d+/.test(location.pathname)) {
    return navigation?.responseStatus === 404 && !sawAny(POST_OPERATIONS);
  }
  if (/^\/[A-Za-z0-9_]{1,50}\/?$/.test(location.pathname)) {
    return document.querySelector('main a[href*="withheld"]') !== null && !sawAny(PROFILE_OPERATIONS);
  }
  return false;
}

/**
 * The Relay client can answer a direct load of a withheld post or profile from the
 * server, leaving no GraphQL response to rewrite, and revisiting the same route reuses
 * that result. Client navigation from any other page does fetch, so a server-rendered
 * withheld page takes one hop through a neutral page and comes back. The stored path
 * makes this a single attempt, so a page a source cannot help with never loops.
 */
function recoverServerRenderedPage(): void {
  const resumePath = storageGet(RESUME_KEY);
  if (resumePath) {
    sessionStorage.removeItem(RESUME_KEY);
    log(`resume ${resumePath}`);
    if (resumePath.startsWith("/")) setTimeout(() => clientNavigate(resumePath), RESUME_NAVIGATION_DELAY_MS);
    return;
  }
  const startPath = location.pathname;
  let checkingSwitch = false;
  for (const delay of SERVER_RENDER_CHECK_DELAYS_MS) {
    setTimeout(() => {
      if (checkingSwitch || location.pathname !== startPath || storageGet(RESUME_KEY) || !isServerRenderedWithheldPage()) return;
      checkingSwitch = true;
      // While switched off, X's page must stay exactly as X sent it.
      void ask({ type: "is-enabled" }, isEnabledResult, { enabled: false }).then(({ enabled }) => {
        if (!enabled) return;
        log("hop: withheld page came from the server");
        try {
          sessionStorage.setItem(RESUME_KEY, location.pathname);
          location.replace(RESUME_LANDING_PATH);
        } catch {
          // Storage is blocked, so the single-attempt guard cannot hold. Leave X's page as it is.
        }
      });
    }, delay);
  }
}

window.addEventListener("load", recoverServerRenderedPage, { once: true });
