import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test as base } from "@playwright/test";
import { DETAIL, DIST, serveX, TWEET_DETAIL_URL, USER_ID, WITHHELD_HANDLE, WITHHELD_ID, WITHHELD_TEXT } from "./harness";

/**
 * Runs the built userscript in real Chromium under a stand-in for a userscript manager. It
 * copies the part that breaks scripts most often: with any grant, `window` is a sandbox
 * object, so writes to it never reach the page and only `unsafeWindow` hooks X's code.
 * Calls to the sources are real, as in the extension spec. A real manager is a manual test.
 */

const SCRIPT_PATH = join(process.cwd(), "dist-userscript", "x-country-withheld-viewer.user.js");
const script = () => readFileSync(SCRIPT_PATH, "utf8");
const metadata = (key: string) => [...script().split("// ==/UserScript==")[0]!.matchAll(new RegExp(`^// @${key}\\s+(.+)$`, "gm"))].map((match) => match[1]);

interface SourceRequest {
  url: string;
  anonymous: boolean;
}

interface Fixtures {
  sandboxMode: string;
  withExtension: boolean;
  lateStart: boolean;
  requests: SourceRequest[];
  context: BrowserContext;
  page: Page;
}

function managerShim(code: string, sandboxMode: string, lateStart: boolean): string {
  return `(() => {
  const values = new Map();
  const menu = new Map();
  const sandbox = new Map();
  let nextId = 1;
  const fakeWindow = new Proxy(window, {
    get(target, key) {
      if (sandbox.has(key)) return sandbox.get(key);
      const value = Reflect.get(target, key);
      return typeof value === "function" && !/^[A-Z]/.test(String(key)) ? value.bind(target) : value;
    },
    set(_target, key, value) {
      sandbox.set(key, value);
      return true;
    },
  });
  window.gmMenu = menu;
  const api = {
    window: fakeWindow,
    unsafeWindow: window,
    GM_info: { scriptHandler: "Stand-in", sandboxMode: ${JSON.stringify(sandboxMode)} },
    GM_xmlhttpRequest(details) {
      window.gmRequest({ url: details.url, anonymous: details.anonymous }).then(details.onload, details.onerror);
    },
    GM_getValue: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    GM_setValue: (key, value) => void values.set(key, value),
    GM_addValueChangeListener: () => 1,
    GM_addStyle(css) {
      const style = document.createElement("style");
      style.textContent = css;
      // This runs before the page has an element to attach to, which a manager waits out too.
      const attach = () => (document.head ?? document.documentElement).append(style);
      if (document.documentElement) attach();
      else new MutationObserver((_records, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        attach();
      }).observe(document, { childList: true });
      return style;
    },
    GM_setClipboard: (text) => { window.gmClipboard = text; },
    GM_registerMenuCommand(label, run, options) {
      const id = options?.id ?? nextId++;
      menu.set(id, { label, run });
      return id;
    },
  };
  const run = () => new Function(...Object.keys(api), ${JSON.stringify(code)})(...Object.values(api));
  // Tampermonkey has been seen to start with X's whole document already parsed.
  if (${lateStart}) document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();`;
}

const test = base.extend<Fixtures>({
  sandboxMode: ["raw", { option: true }],
  withExtension: [false, { option: true }],
  lateStart: [false, { option: true }],
  // eslint-disable-next-line no-empty-pattern
  requests: async ({}, use) => {
    await use([]);
  },
  context: async ({ sandboxMode, withExtension, lateStart, requests }, use) => {
    const profile = mkdtempSync(join(tmpdir(), "playwright_xcwv-"));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        ...(withExtension ? { args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`] } : {}),
      });
      await serveX(context);
      await context.exposeFunction("gmRequest", async (request: SourceRequest) => {
        requests.push(request);
        const response = await fetch(request.url, { headers: { accept: "application/json" } });
        return { status: response.status, responseText: await response.text(), responseHeaders: "" };
      });
      await context.addInitScript({ content: managerShim(script(), sandboxMode, lateStart) });
      await use(context);
    } finally {
      // Closing a persistent context ends the browser process tree, also on a failed test.
      await context?.close().catch(() => {});
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://x.com/harness");
    await use(page);
    expect(errors).toEqual([]);
  },
});

type Harness = {
  viaFetch(url: string): Promise<never>;
  viaXhr(url: string, style: string): Promise<never>;
  renderPost(id: string, handle: string): void;
};
const viaFetch = (page: Page, url: string) => page.evaluate((u) => (window as never as Harness).viaFetch(u), url);
const viaXhr = (page: Page, url: string, style: string) =>
  page.evaluate(([u, s]) => (window as never as Harness).viaXhr(u as string, s as string), [url, style]);
const clickMenu = (page: Page, start: string) =>
  page.evaluate((label) => {
    const entries = [...(window as never as { gmMenu: Map<number, { label: string; run(): void }> }).gmMenu.values()];
    entries.find((entry) => entry.label.startsWith(label))?.run();
  }, start);
const menuLabels = (page: Page) =>
  page.evaluate(() => [...(window as never as { gmMenu: Map<number, { label: string }> }).gmMenu.values()].map((entry) => entry.label));

function recoveredText(body: unknown): string | undefined {
  const { data } = body as { data: { threaded_conversation_with_injections_v2: { instructions: Array<{ entries: Array<{ content: { items?: Array<{ item: { itemContent: { tweet_results: { result: { legacy: { full_text: string } } } } } }> } }> }> } } };
  return data.threaded_conversation_with_injections_v2.instructions[0]?.entries[1]?.content.items?.[0]?.item.itemContent.tweet_results.result.legacy.full_text;
}

base("the header gives the manager what the code needs and matches the extension", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/manifest.json"), "utf8"));
  expect(metadata("version")).toEqual([manifest.version]);
  expect(metadata("match")).toEqual(manifest.content_scripts[0].matches);
  expect(metadata("connect")).toEqual(["api.fxtwitter.com", "mdfromx.com"]);
  expect(metadata("run-at")).toEqual(["document-start"]);
  expect(metadata("sandbox")).toEqual(["raw"]);
  expect(metadata("inject-into")).toEqual(["page"]);
  expect(metadata("downloadURL")[0]).toMatch(/\/releases\/latest\/download\/x-country-withheld-viewer\.user\.js$/);
  expect(script().startsWith("// ==UserScript==")).toBe(true);

  // A manager hides any API that was not granted, and the script only finds out at runtime.
  const body = script().split("// ==/UserScript==")[1]!;
  const used = new Set([...body.matchAll(/\b(GM_[A-Za-z]+|unsafeWindow)\b/g)].map((match) => match[1]));
  used.delete("GM_info");
  expect([...used].sort()).toEqual([...metadata("grant")].sort());
});

test("fetch: a real tombstone becomes a real post from a real source", async ({ page }) => {
  expect(recoveredText(await viaFetch(page, TWEET_DETAIL_URL))).toContain(WITHHELD_TEXT);
});

for (const style of ["readystate-after-open", "onload", "json"]) {
  test(`xhr: the rewritten body reaches a page using ${style}`, async ({ page }) => {
    expect(recoveredText(await viaXhr(page, TWEET_DETAIL_URL, style))).toContain(WITHHELD_TEXT);
  });
}

test("sources are reached without cookies, and only the expected ones", async ({ page, requests }) => {
  await viaFetch(page, TWEET_DETAIL_URL);
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.anonymous).toBe(true);
    expect(["api.fxtwitter.com", "mdfromx.com"]).toContain(new URL(request.url).hostname);
  }
});

test("the marker and the glow appear on a recovered post", async ({ page }) => {
  await page.evaluate(([id, handle]) => (window as never as Harness).renderPost(id as string, handle as string), [WITHHELD_ID, WITHHELD_HANDLE]);
  await viaFetch(page, TWEET_DETAIL_URL);
  await expect(page.locator(`article[data-post="${WITHHELD_ID}"] .xcwv-mark`)).toHaveCount(1);
  await expect(page.locator(`[data-xcwv-recovered="${WITHHELD_ID}"]`)).toHaveCSS("box-shadow", /rgba\(29, 155, 240/);
});

test("a signed-in profile opens, and a later REST copy cannot flip it back", async ({ page }) => {
  const user = (await viaXhr(page, "/i/api/graphql/signed-in/UserByScreenName", "onload")) as { data: { user: { result: { rest_id: string; core: { name: string } } } } };
  expect(user.data.user.result.rest_id).toBe(USER_ID);
  expect(user.data.user.result.core.name).toBeTruthy();
  const list = (await viaXhr(page, "/i/api/1.1/friends/following/list.json", "onload")) as { users: Array<{ withheld_scope: string; following: boolean }> };
  expect(list.users[0]).toMatchObject({ withheld_scope: "", following: true });
});

test("the menu carries the popup's settings and they apply without a reload", async ({ page }) => {
  expect(await menuLabels(page)).toEqual([
    "Gizlenen gönderileri göster: Açık",
    "x.md yedeği: Açık",
    "Parlayan kenarlık: Açık",
    "Dil: Türkçe",
    "Kurtarılan gönderileri temizle",
    "Tanı bilgisini kopyala",
  ]);

  await page.evaluate(([id, handle]) => (window as never as Harness).renderPost(id as string, handle as string), [WITHHELD_ID, WITHHELD_HANDLE]);
  await viaFetch(page, TWEET_DETAIL_URL);
  const post = page.locator(`[data-xcwv-recovered="${WITHHELD_ID}"]`);
  await expect(post).toHaveCSS("box-shadow", /rgba\(29, 155, 240/);

  await clickMenu(page, "Parlayan kenarlık");
  await expect(post).toHaveCount(0);
  await expect(page.locator(".xcwv-mark")).toHaveCount(1);

  await clickMenu(page, "Dil");
  await expect(page.locator(".xcwv-mark")).toHaveAttribute("title", /Withheld in|Source/);
  expect((await menuLabels(page))[3]).toBe("Language: English");
});

test("switched off from the menu: X's tombstone stays and no source is asked", async ({ page, requests }) => {
  await clickMenu(page, "Gizlenen gönderileri göster");
  const text = await page.evaluate((url) => fetch(url).then((response) => response.text()), TWEET_DETAIL_URL);
  expect(text).toBe(DETAIL);
  expect(requests).toEqual([]);
});

test("the diagnostics copy names this build and how it was injected", async ({ page }) => {
  await viaFetch(page, TWEET_DETAIL_URL);
  await clickMenu(page, "Tanı bilgisini");
  await expect.poll(() => page.evaluate(() => (window as never as { gmClipboard?: string }).gmClipboard)).toContain("userscript");
  const report = await page.evaluate(() => (window as never as { gmClipboard: string }).gmClipboard);
  expect(report).toMatch(/Stand-in mode=raw scripts=\d+/);
  expect(report).toContain("TweetDetail");
});

test.describe("when the manager starts the script after X's first request", () => {
  test.use({ lateStart: true });

  test("it says so, and a withheld post takes one hop and comes back through the client", async ({ context }) => {
    const page = await context.newPage();
    const lines: string[] = [];
    page.on("console", (message) => lines.push(message.text()));
    await page.goto("https://x.com/late/status/20");
    await expect.poll(() => lines.join("\n")).toContain("started after X's requests: TweetDetail");
    await expect.poll(() => lines.join("\n"), { timeout: 15_000 }).toContain("resume /late/status/20");
    await expect.poll(() => page.evaluate(() => (window as never as { popstates: number }).popstates), { timeout: 15_000 }).toBe(1);
    expect(new URL(page.url()).pathname).toBe("/late/status/20");
  });

  test("responses after the start are still rewritten", async ({ page }) => {
    expect(recoveredText(await viaFetch(page, TWEET_DETAIL_URL))).toContain(WITHHELD_TEXT);
  });

  test("a page with no notice stays where it is", async ({ page }) => {
    await page.goto("https://x.com/jack/status/20");
    await page.waitForTimeout(5_000);
    expect(new URL(page.url()).pathname).toBe("/jack/status/20");
    expect(await page.evaluate(() => (window as never as { popstates: number }).popstates)).toBe(0);
  });
});

test.describe("in a sandbox that cannot reach the page", () => {
  test.use({ sandboxMode: "dom" });

  test("it says so and leaves X alone", async ({ context, requests }) => {
    const page = await context.newPage();
    const lines: string[] = [];
    page.on("console", (message) => lines.push(message.text()));
    await page.goto("https://x.com/harness");
    await expect.poll(() => lines.join("\n")).toContain("cannot read X's responses from this sandbox");
    const text = await page.evaluate((url) => fetch(url).then((response) => response.text()), TWEET_DETAIL_URL);
    expect(text).toBe(DETAIL);
    expect(requests).toEqual([]);
  });
});

test.describe("beside the extension", () => {
  test.use({ withExtension: true });

  test("only one of them runs, and the post is still recovered", async ({ context }) => {
    const page = await context.newPage();
    const lines: string[] = [];
    page.on("console", (message) => lines.push(message.text()));
    await page.goto("https://x.com/harness");
    await expect.poll(() => lines.join("\n")).toContain("already runs on this page");
    expect(lines.filter((line) => line.includes("stays off"))).toHaveLength(1);
    expect(lines.filter((line) => / active /.test(line))).toHaveLength(1);
    expect(recoveredText(await viaFetch(page, TWEET_DETAIL_URL))).toContain(WITHHELD_TEXT);
  });
});
