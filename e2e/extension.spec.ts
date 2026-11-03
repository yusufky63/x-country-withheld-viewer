import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test as base, type Worker } from "@playwright/test";

/**
 * Loads the built extension into real Chromium. x.com is served from these routes, so
 * no request reaches X. The service worker's calls to FxTwitter are real, which is the
 * point: they prove a source returns the post. The fixtures hold sample IDs, so these tests
 * swap in public posts and accounts that a live source can really answer for.
 */

const DIST = join(process.cwd(), "dist");
const WITHHELD_ID = "20";
const WITHHELD_HANDLE = "jack";
const WITHHELD_TEXT = "just setting up my twttr";
const UNKNOWN_ID = "1111111111111111111";
const USER_ID = "11348282";
const USER_HANDLE = "NASA";

const fixture = (name: string) => readFileSync(join(process.cwd(), "src/core/__fixtures__", name), "utf8");
const DETAIL = fixture("x-tweetdetail-withheld.json").replaceAll("1900000000000000002", WITHHELD_ID).replaceAll("example_replier", WITHHELD_HANDLE);
const asLiveUser = (json: string) => json.replaceAll("1800000000000000003", USER_ID).replaceAll("BlockedSample", USER_HANDLE);
const BLOCKED_USER = asLiveUser(fixture("x-user-withheld-relay.json"));
const SIGNED_IN_USER = asLiveUser(fixture("x-user-withheld-logged-in.json"));
const UNRECOVERABLE_DETAIL = DETAIL.replaceAll(WITHHELD_ID, UNKNOWN_ID);

const HARNESS = `<!doctype html><html><head><title>harness</title></head><body><main id="root"></main><script>
window.popstates = 0;
window.addEventListener("popstate", () => { window.popstates += 1; });
window.viaFetch = async (url) => (await fetch(url)).json();
window.viaXhr = (url, style) => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest();
  x.onerror = () => reject(new Error("xhr error"));
  const fromText = () => resolve(JSON.parse(x.responseText));
  if (style === "readystate-before-open") x.onreadystatechange = () => { if (x.readyState === 4) fromText(); };
  x.open("GET", url);
  if (style === "readystate-after-open") x.onreadystatechange = () => { if (x.readyState === 4) fromText(); };
  if (style === "listener") x.addEventListener("load", fromText);
  if (style === "onload") x.onload = fromText;
  if (style === "onloadend") x.onloadend = fromText;
  if (style === "json") { x.responseType = "json"; x.onload = () => resolve(x.response); }
  if (style === "response-text") x.onload = () => resolve(JSON.parse(x.response));
  x.send();
});
window.renderPost = (id, handle) => {
  document.getElementById("root").innerHTML += '<article data-post="' + id + '"><a href="/' + handle + '/status/' + id + '"><time>3h</time></a></article>';
};
window.renderTombstone = (text) => {
  document.getElementById("root").innerHTML += '<div data-tombstone><div dir="auto"><span>' + text + '</span></div></div>';
};
</script></body></html>`;

/** X's withheld notice as it comes from the server, plus one GraphQL call the page makes anyway. */
function withheldPage(graphqlPath: string): string {
  return HARNESS.replace(
    '<main id="root"></main>',
    `<main id="root"><a href="https://help.x.com/en/rules-and-policies/post-withheld-by-country">Learn more</a></main><script>fetch("${graphqlPath}");</script>`,
  );
}

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  page: Page;
}

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), "playwright_xcwv-"));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        // Lets a machine reuse a Chromium it already has instead of downloading a matching one.
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
      });
      await context.route("https://x.com/**", (route) => {
        const url = route.request().url();
        const path = new URL(url).pathname;
        if (path === "/ServerRenderedProfile") return route.fulfill({ contentType: "text/html", body: withheldPage("/i/api/graphql/abc/HomeTimeline") });
        if (path === "/ClientRenderedProfile") return route.fulfill({ contentType: "text/html", body: withheldPage("/i/api/graphql/abc/UserByScreenName") });
        if (url.includes("/graphql/") && url.includes("/UserOriginalsTimeline")) return route.fulfill({ status: 404, body: "" });
        if (url.includes("/graphql/signed-in/UserByScreenName")) return route.fulfill({ contentType: "application/json", body: SIGNED_IN_USER });
        if (url.includes("/graphql/") && url.includes("/UnrecoverableDetail")) return route.fulfill({ contentType: "application/json", body: UNRECOVERABLE_DETAIL });
        if (url.includes("/graphql/") && url.includes("/TweetDetail")) return route.fulfill({ contentType: "application/json", body: DETAIL });
        if (url.includes("/graphql/") && url.includes("/UserByScreenName")) return route.fulfill({ contentType: "application/json", body: BLOCKED_USER });
        if (url.includes("/graphql/") && url.includes("/UserTweets")) return route.fulfill({ status: 403, contentType: "application/json", body: '{"errors":[{"message":"withheld"}]}' });
        if (url.includes("/graphql/")) return route.fulfill({ contentType: "application/json", body: '{"data":{"ok":true}}' });
        return route.fulfill({ contentType: "text/html", body: HARNESS });
      });
      await use(context);
    } finally {
      // Closing a persistent context ends the browser process tree, also on a failed test.
      await context?.close().catch(() => {});
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  page: async ({ context, worker }, use) => {
    await worker.evaluate(() => chrome.storage.local.clear());
    const page = await context.newPage();
    await page.goto("https://x.com/harness");
    await use(page);
  },
});

const TWEET_DETAIL_URL = "/i/api/graphql/qpemjmVMoTWDvcRT43JIVQ/TweetDetail?variables=%7B%7D";

interface ConversationBody {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: Array<{
        entries: Array<{ content: { items?: Array<{ item: { itemContent: { tweet_results: { result: Record<string, never> & { __typename: string; rest_id: string; legacy: { full_text: string } } } } } }> } }>;
      }>;
    };
  };
}

function recovered(body: ConversationBody) {
  return body.data.threaded_conversation_with_injections_v2.instructions[0]?.entries[1]?.content.items?.[0]?.item.itemContent.tweet_results.result;
}

test("fetch: a real tombstone becomes a real post from a real source", async ({ page }) => {
  const body = await page.evaluate((url) => (window as never as { viaFetch(u: string): Promise<ConversationBody> }).viaFetch(url), TWEET_DETAIL_URL);
  const result = recovered(body);
  expect(result?.__typename).toBe("Tweet");
  expect(result?.rest_id).toBe(WITHHELD_ID);
  expect(result?.legacy.full_text).toContain(WITHHELD_TEXT);
});

for (const style of ["readystate-before-open", "readystate-after-open", "listener", "onload", "onloadend", "json", "response-text"]) {
  test(`xhr: rewritten body reaches a page using ${style}`, async ({ page }) => {
    const body = await page.evaluate(
      ([url, xhrStyle]) => (window as never as { viaXhr(u: string, s: string): Promise<ConversationBody> }).viaXhr(url as string, xhrStyle as string),
      [TWEET_DETAIL_URL, style],
    );
    expect(recovered(body)?.rest_id).toBe(WITHHELD_ID);
  });
}

test("responses with nothing withheld pass through untouched", async ({ page }) => {
  const body = await page.evaluate(() => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch("/i/api/graphql/abc/HomeTimeline"));
  expect(body).toEqual({ data: { ok: true } });
});

test("the marker appears beside the post's permalink and names its source", async ({ page }) => {
  await page.evaluate(([id, handle]) => (window as never as { renderPost(i: string, h: string): void }).renderPost(id as string, handle as string), [WITHHELD_ID, WITHHELD_HANDLE]);
  await page.evaluate((url) => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch(url), TWEET_DETAIL_URL);
  const mark = page.locator(`article[data-post="${WITHHELD_ID}"] .xcwv-mark`);
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute("title", "Gizlendiği ülke: Türkiye. Kaynak: FxTwitter.");
  const box = await mark.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(14);
  expect(box?.height).toBeLessThanOrEqual(14);
});

test("switched off: X's tombstone stays and no source is asked", async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  const text = await page.evaluate((url) => fetch(url).then((response) => response.text()), TWEET_DETAIL_URL);
  expect(text).toBe(DETAIL);
});

test("an unrecoverable post keeps X's tombstone and gets a plain note", async ({ page }) => {
  await page.evaluate(() =>
    (window as never as { renderTombstone(t: string): void }).renderTombstone(
      "This Post from @jack has been withheld in Turkey in response to a legal demand. Learn more",
    ),
  );
  const text = await page.evaluate(() => fetch("/i/api/graphql/abc/UnrecoverableDetail").then((response) => response.text()));
  expect(text).toContain("TweetTombstone");
  // Which note appears depends on whether the live x.md answers within the recovery budget.
  await expect(page.locator(".xcwv-note")).toHaveText(/Alternatif kaynaklarda bulunamadı|yanıt vermedi/, { timeout: 15_000 });
});

test("the example withheld profile and its timeline come back through X's own requests", async ({ page }) => {
  const user = await page.evaluate(() =>
    (window as never as { viaFetch(u: string): Promise<{ data: { user_result_by_screen_name: { result: Record<string, { name?: string; withheld_scope?: string }> } } }> }).viaFetch(
      "/i/api/graphql/abc/UserByScreenName",
    ),
  );
  expect(user.data.user_result_by_screen_name.result.legacy?.withheld_scope).toBe("");
  expect(user.data.user_result_by_screen_name.result.core?.name).toBeTruthy();

  const variables = encodeURIComponent(JSON.stringify({ userId: USER_ID, count: 20 }));
  const timeline = await page.evaluate(
    (url) => fetch(url).then(async (response) => ({ status: response.status, body: await response.json() })),
    `/i/api/graphql/abc/UserTweets?variables=${variables}`,
  );
  expect(timeline.status).toBe(200);
  const entries = timeline.body.data.user.result.timeline.timeline.instructions[0].entries as Array<{ entryId: string; content: { value?: string } }>;
  expect(entries.filter((entry) => entry.entryId.startsWith("tweet-")).length).toBeGreaterThan(0);

  const cursor = entries.at(-1)?.content.value;
  expect(cursor?.startsWith("xcwv:")).toBe(true);
  const nextVariables = encodeURIComponent(JSON.stringify({ userId: USER_ID, count: 20, cursor }));
  const next = await page.evaluate(
    (url) => (window as never as { viaXhr(u: string, s: string): Promise<{ data: { user: { result: { timeline: { timeline: { instructions: Array<{ entries: unknown[] }> } } } } } }> }).viaXhr(url, "listener"),
    `/i/api/graphql/abc/UserTweets?variables=${nextVariables}`,
  );
  expect(next.data.user.result.timeline.timeline.instructions[0]?.entries.length).toBeGreaterThan(0);
});

test("a recovered post's border glows and another post's does not", async ({ page }) => {
  await page.evaluate(([id, handle]) => {
    const harness = window as never as { renderPost(i: string, h: string): void };
    harness.renderPost("1", "someone");
    harness.renderPost(id as string, handle as string);
  }, [WITHHELD_ID, WITHHELD_HANDLE]);
  await page.evaluate((url) => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch(url), TWEET_DETAIL_URL);
  const recovered = page.locator(`[data-xcwv-recovered="${WITHHELD_ID}"]`);
  await expect(recovered).toHaveCount(1);
  await expect(recovered).toHaveCSS("box-shadow", /rgba\(29, 155, 240/);
  await expect(recovered).toHaveCSS("border-radius", "0px");
  await expect(page.locator('article[data-post="1"]')).not.toHaveAttribute("data-xcwv-recovered");
});

test("the real signed-in response for the example account becomes a normal profile", async ({ page }) => {
  for (const style of ["fetch", "xhr"]) {
    const user = await page.evaluate(([url, transport]) => {
      const harness = window as never as { viaFetch(u: string): Promise<unknown>; viaXhr(u: string, s: string): Promise<unknown> };
      return (transport === "fetch" ? harness.viaFetch(url as string) : harness.viaXhr(url as string, "onload")) as Promise<{
        data: { user: { result: { core: { name: string }; avatar: { image_url: string }; profile_bio: { description: string }; relationship_perspectives: { following: boolean } } } };
      }>;
    }, ["/i/api/graphql/signed-in/UserByScreenName", style]);
    const { core, avatar, profile_bio: bio, relationship_perspectives: perspectives } = user.data.user.result;
    expect(core.name).toBeTruthy();
    expect(avatar.image_url).toMatch(/^https:\/\/pbs\.twimg\.com\//);
    expect(bio.description).not.toContain("withheld");
    expect(perspectives.following).toBe(true);
  }
});

test("classic client: the default Posts tab of a blocked account uses the classic path, without reposts", async ({ page }) => {
  await page.evaluate(() => (window as never as { viaXhr(u: string, s: string): Promise<unknown> }).viaXhr("/i/api/graphql/signed-in/UserByScreenName", "onload"));
  const variables = encodeURIComponent(JSON.stringify({ userId: USER_ID, count: 20, cursor: null }));
  const body = await page.evaluate(
    (url) => (window as never as { viaXhr(u: string, s: string): Promise<unknown> }).viaXhr(url, "readystate-after-open"),
    `/i/api/graphql/abc/UserOriginalsTimeline?variables=${variables}`,
  );
  const parsed = body as {
    data: {
      user_result_by_screen_name?: unknown;
      user: { result: { __typename: string; timeline: { timeline: { instructions: Array<{ entries: Array<{ entryId: string; content: { itemContent?: { socialContext?: unknown } } }> }> } } } };
    };
  };
  expect(parsed.data.user_result_by_screen_name).toBeUndefined();
  expect(parsed.data.user.result.__typename).toBe("User");
  const entries = parsed.data.user.result.timeline.timeline.instructions[0]?.entries ?? [];
  const posts = entries.filter((entry) => entry.entryId.startsWith("tweet-"));
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.every((entry) => entry.content.itemContent?.socialContext === undefined)).toBe(true);
});

test("the glow can be switched off and back on without a reload, and the eye stays", async ({ page, worker }) => {
  await page.evaluate(([id, handle]) => (window as never as { renderPost(i: string, h: string): void }).renderPost(id as string, handle as string), [WITHHELD_ID, WITHHELD_HANDLE]);
  await page.evaluate((url) => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch(url), TWEET_DETAIL_URL);
  const glow = page.locator(`[data-xcwv-recovered="${WITHHELD_ID}"]`);
  await expect(glow).toHaveCount(1);

  await worker.evaluate(() => chrome.storage.local.set({ glowBorder: false }));
  await expect(glow).toHaveCount(0);
  await expect(page.locator(".xcwv-mark")).toHaveCount(1);

  await worker.evaluate(() => chrome.storage.local.set({ glowBorder: true }));
  await expect(glow).toHaveCount(1);
});

test("a saved glow setting applies to posts recovered after a reload", async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ glowBorder: false }));
  await page.reload();
  await page.evaluate(([id, handle]) => (window as never as { renderPost(i: string, h: string): void }).renderPost(id as string, handle as string), [WITHHELD_ID, WITHHELD_HANDLE]);
  await page.evaluate((url) => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch(url), TWEET_DETAIL_URL);
  await expect(page.locator(".xcwv-mark")).toHaveCount(1);
  await expect(page.locator("[data-xcwv-recovered]")).toHaveCount(0);
});

test("the console shows the extension is running and what X sent", async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.clear());
  const page = await context.newPage();
  const lines: string[] = [];
  page.on("console", (message) => lines.push(message.text()));
  await page.goto("https://x.com/harness");
  await page.evaluate(() => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch("/i/api/graphql/abc/UserByScreenName"));
  await expect.poll(() => lines.join("\n")).toContain("[X Withheld Viewer] /harness active");
  await expect.poll(() => lines.join("\n")).toContain("UserByScreenName status=200");
  await expect.poll(() => lines.join("\n")).toContain("blocked=1");
});

test("relay client: the posts tab of a blocked account is answered despite X's 404", async ({ page }) => {
  await page.evaluate(() => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch("/i/api/graphql/abc/UserByScreenName"));
  const variables = encodeURIComponent(JSON.stringify({ screenName: USER_HANDLE, count: 20, cursor: null, __relay_internal__pv__x: false }));
  const timeline = await page.evaluate(
    (url) => fetch(url).then(async (response) => ({ status: response.status, body: await response.json() })),
    `https://x.com/graphql/abc/UserOriginalsTimeline?variables=${variables}`,
  );
  expect(timeline.status).toBe(200);
  const { instructions } = timeline.body.data.user_result_by_screen_name.result.profile_user_originals_timeline.timeline;
  expect(instructions[0].entries[0].entry_id).toMatch(/^tweet-/);
  expect(instructions[0].entries[0].content.content.tweet_results.result.details.full_text).toBeTruthy();
});

test("a withheld page that came from the server takes one hop and comes back through the client", async ({ page }) => {
  await page.goto("https://x.com/ServerRenderedProfile");
  await expect.poll(() => page.evaluate(() => (window as never as { popstates: number }).popstates), { timeout: 15_000 }).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/ServerRenderedProfile");
});

test("while switched off, a server-rendered withheld page does not hop", async ({ page, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await page.goto("https://x.com/ServerRenderedProfile");
  await page.waitForTimeout(5_000);
  expect(new URL(page.url()).pathname).toBe("/ServerRenderedProfile");
  expect(await page.evaluate(() => (window as never as { popstates: number }).popstates)).toBe(0);
});

test("a withheld page whose request the hook saw does not hop", async ({ page }) => {
  await page.goto("https://x.com/ClientRenderedProfile");
  await page.waitForTimeout(5_000);
  expect(new URL(page.url()).pathname).toBe("/ClientRenderedProfile");
  expect(await page.evaluate(() => (window as never as { popstates: number }).popstates)).toBe(0);
});

test("diagnostics record X's response shape for the popup", async ({ page, worker }) => {
  await page.evaluate(() => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch("/i/api/graphql/abc/UserByScreenName"));
  await expect
    .poll(async () => {
      const { diagnostics } = (await worker.evaluate(() => chrome.storage.session.get("diagnostics"))) as { diagnostics?: string[] };
      return diagnostics?.join("\n") ?? "";
    })
    .toContain("fetch UserByScreenName status=200");
});

test("the language can be switched to English without a reload", async ({ page, worker }) => {
  await page.evaluate(([id, handle]) => (window as never as { renderPost(i: string, h: string): void }).renderPost(id as string, handle as string), [WITHHELD_ID, WITHHELD_HANDLE]);
  await page.evaluate((url) => (window as never as { viaFetch(u: string): Promise<unknown> }).viaFetch(url), TWEET_DETAIL_URL);
  const mark = page.locator(".xcwv-mark");
  await expect(mark).toHaveAttribute("title", "Gizlendiği ülke: Türkiye. Kaynak: FxTwitter.");
  await worker.evaluate(() => chrome.storage.local.set({ language: "en" }));
  await expect(mark).toHaveAttribute("title", "Withheld in Turkey. Shown from FxTwitter.");
  await expect(mark).toHaveCount(1);
});

test("popup: opens in Turkish and switches to English", async ({ context, worker }) => {
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.clear());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("body.ready")).toHaveCount(1);
  await expect(page.locator('[data-i18n="sources"]')).toHaveText("Kaynaklar");
  await expect(page.locator("#language-tr")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");

  await page.locator("#language-en").check({ force: true });
  await expect(page.locator('[data-i18n="sources"]')).toHaveText("Sources");
  await expect(page.locator("#clear")).toHaveText("Clear recovered posts");
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get("language"))).toEqual({ language: "en" });

  await page.reload();
  await expect(page.locator('[data-i18n="sources"]')).toHaveText("Sources");
  await expect(page.locator("#language-en")).toBeChecked();
});

test("popup: settings persist and it renders in both themes", async ({ context, worker }) => {
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 520 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator("#enabled")).toBeChecked();
    await expect(page.locator("body.ready")).toHaveCount(1);
    await page.screenshot({ path: `test-results/popup-${colorScheme}.png`, fullPage: true });
  }
  await page.locator("#enabled").uncheck({ force: true });
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get("enabled"))).toEqual({ enabled: false });
  await page.reload();
  await expect(page.locator("#enabled")).not.toBeChecked();
});
