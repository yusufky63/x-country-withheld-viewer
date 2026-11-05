import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test as base, type Worker } from "@playwright/test";
import { DIST, WITHHELD_ID, WITHHELD_HANDLE, WITHHELD_TEXT, USER_ID, USER_HANDLE, DETAIL, TWEET_DETAIL_URL, serveX } from "./harness";

/**
 * Loads the built extension into real Chromium. x.com is served from these routes, so
 * no request reaches X. The service worker's calls to FxTwitter are real, which is the
 * point: they prove a source returns the post. The fixtures hold sample IDs, so these tests
 * swap in public posts and accounts that a live source can really answer for.
 */

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  page: Page;
}

/** Runs in the worker. Tests start from a user who agreed, apart from the ones about the question itself. */
async function resetToAgreed(): Promise<void> {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ consent: "accepted" });
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
      await serveX(context);
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
    await worker.evaluate(resetToAgreed);
    const page = await context.newPage();
    await page.goto("https://x.com/harness");
    await use(page);
  },
});


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

test("a later REST list cannot flip a recovered profile back", async ({ page }) => {
  const url = "/i/api/1.1/friends/following/list.json";
  const viaXhr = (target: string) => page.evaluate((u) => (window as never as { viaXhr(a: string, s: string): Promise<{ users: Array<Record<string, unknown>> }> }).viaXhr(u, "readystate-after-open"), target);

  // Nothing is recovered yet, so X's own answer passes through untouched.
  expect((await viaXhr(url)).users[0]?.withheld_scope).toBe("user");

  await page.evaluate(() => (window as never as { viaXhr(u: string, s: string): Promise<unknown> }).viaXhr("/i/api/graphql/signed-in/UserByScreenName", "onload"));
  const user = (await viaXhr(url)).users[0];
  expect(user?.withheld_scope).toBe("");
  expect(user?.withheld_in_countries).toEqual([]);
  expect(user?.name).toBeTruthy();
  expect(user?.following).toBe(true);
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
  await worker.evaluate(resetToAgreed);
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

test("a withheld post whose request the hook saw does not hop", async ({ page }) => {
  await page.goto("https://x.com/late/status/20");
  await page.waitForTimeout(5_000);
  expect(new URL(page.url()).pathname).toBe("/late/status/20");
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
  await worker.evaluate(resetToAgreed);
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
  await worker.evaluate(resetToAgreed);
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

test.describe("consent", () => {
  test("a new install asks in its own tab", async ({ context, worker }) => {
    const url = `chrome-extension://${new URL(worker.url()).host}/popup.html?welcome`;
    await expect.poll(() => context.pages().map((page) => page.url())).toContain(url);
  });

  test("before an answer X stays as it is, nothing is kept, and agreeing starts it", async ({ context, worker }) => {
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto("https://x.com/harness");
    const fetchDetail = () => page.evaluate((url) => fetch(url).then((response) => response.text()), TWEET_DETAIL_URL);
    expect(await fetchDetail()).toBe(DETAIL);
    expect(await worker.evaluate(() => chrome.storage.session.get(["diagnostics", "stats"]))).toEqual({});

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("#enabled")).toBeHidden();
    await expect(popup.locator("#clear")).toBeHidden();
    await expect(popup.locator("#language-en")).toBeAttached();
    await popup.locator("#accept").click();
    await expect(popup.locator("#consent-note")).toHaveText("Eklenti açık. Başlaması için açık X sekmelerini yenile.");
    await expect(popup.locator("#consent")).toBeHidden();
    await expect(popup.locator(".switch").first()).toBeVisible();

    await page.reload();
    expect(await fetchDetail()).toContain(WITHHELD_TEXT);
  });

  test("a no keeps it off, stays after a reload, and can be changed", async ({ context, worker }) => {
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // A person cannot press anything before this either, since the popup is invisible until then.
    await expect(popup.locator("body.ready")).toHaveCount(1);
    await popup.locator("#language-en").check({ force: true });
    await popup.locator("#decline").click();
    await expect(popup.locator("#consent-note")).toHaveText("It stays off. You can turn it on here if you change your mind.");
    await popup.reload();
    await expect(popup.locator("#accept")).toBeVisible();
    await expect(popup.locator("#consent-note")).toBeVisible();

    const page = await context.newPage();
    await page.goto("https://x.com/harness");
    expect(await page.evaluate((url) => fetch(url).then((response) => response.text()), TWEET_DETAIL_URL)).toBe(DETAIL);

    await popup.locator("#accept").click();
    await expect.poll(() => worker.evaluate(() => chrome.storage.local.get("consent"))).toEqual({ consent: "accepted" });
  });

  test("the question fits the popup in both themes", async ({ context, worker }) => {
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 600 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(page.locator("body.ready")).toHaveCount(1);
      await page.screenshot({ path: `test-results/consent-${colorScheme}.png`, fullPage: true });
    }
    // A browser popup stops growing at 600px and scrolls after that, which would hide the answers.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(600);
    await page.locator("#language-en").check({ force: true });
    await expect(page.locator("#accept")).toHaveText("I agree, turn it on");
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(600);
    await page.screenshot({ path: "test-results/consent-en.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/popup.html?welcome`);
    await expect(page.locator("html.tab")).toHaveCount(1);
    await page.screenshot({ path: "test-results/consent-tab.png" });
  });
});
