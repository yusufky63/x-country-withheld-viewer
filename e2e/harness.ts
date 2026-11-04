import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";

/** The stand-in for x.com that both the extension and the userscript specs run against. */

export const DIST = join(process.cwd(), "dist");
export const WITHHELD_ID = "20";
export const WITHHELD_HANDLE = "jack";
export const WITHHELD_TEXT = "just setting up my twttr";
export const UNKNOWN_ID = "1111111111111111111";
export const USER_ID = "11348282";
export const USER_HANDLE = "NASA";

export const fixture = (name: string) => readFileSync(join(process.cwd(), "src/core/__fixtures__", name), "utf8");
export const DETAIL = fixture("x-tweetdetail-withheld.json").replaceAll("1900000000000000002", WITHHELD_ID).replaceAll("example_replier", WITHHELD_HANDLE);
export const asLiveUser = (json: string) => json.replaceAll("1800000000000000003", USER_ID).replaceAll("BlockedSample", USER_HANDLE);
export const BLOCKED_USER = asLiveUser(fixture("x-user-withheld-relay.json"));
export const SIGNED_IN_USER = asLiveUser(fixture("x-user-withheld-logged-in.json"));
export const FOLLOWING_LIST = JSON.stringify({ users: [{ id_str: USER_ID, screen_name: USER_HANDLE, name: "", following: true, withheld_scope: "user", withheld_in_countries: ["TR"] }] });
export const UNRECOVERABLE_DETAIL = DETAIL.replaceAll(WITHHELD_ID, UNKNOWN_ID);

export const HARNESS = `<!doctype html><html><head><title>harness</title></head><body><main id="root"></main><script>
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
export function withheldPage(graphqlPath: string): string {
  return HARNESS.replace(
    '<main id="root"></main>',
    `<main id="root"><a href="https://help.x.com/en/rules-and-policies/post-withheld-by-country">Learn more</a></main><script>fetch("${graphqlPath}");</script>`,
  );
}

export const TWEET_DETAIL_URL = "/i/api/graphql/qpemjmVMoTWDvcRT43JIVQ/TweetDetail?variables=%7B%7D";

export async function serveX(context: BrowserContext): Promise<void> {
  await context.route("https://x.com/**", (route) => {
      const url = route.request().url();
      const path = new URL(url).pathname;
      if (path === "/ServerRenderedProfile") return route.fulfill({ contentType: "text/html", body: withheldPage("/i/api/graphql/abc/HomeTimeline") });
      if (path === "/late/status/20") return route.fulfill({ contentType: "text/html", body: withheldPage("/i/api/graphql/abc/TweetDetail") });
    if (path === "/ClientRenderedProfile") return route.fulfill({ contentType: "text/html", body: withheldPage("/i/api/graphql/abc/UserByScreenName") });
      if (url.includes("/graphql/") && url.includes("/UserOriginalsTimeline")) return route.fulfill({ status: 404, body: "" });
      if (url.includes("/graphql/signed-in/UserByScreenName")) return route.fulfill({ contentType: "application/json", body: SIGNED_IN_USER });
      if (url.includes("/1.1/friends/following/list.json")) return route.fulfill({ contentType: "application/json", body: FOLLOWING_LIST });
      if (url.includes("/graphql/") && url.includes("/UnrecoverableDetail")) return route.fulfill({ contentType: "application/json", body: UNRECOVERABLE_DETAIL });
      if (url.includes("/graphql/") && url.includes("/TweetDetail")) return route.fulfill({ contentType: "application/json", body: DETAIL });
      if (url.includes("/graphql/") && url.includes("/UserByScreenName")) return route.fulfill({ contentType: "application/json", body: BLOCKED_USER });
      if (url.includes("/graphql/") && url.includes("/UserTweets")) return route.fulfill({ status: 403, contentType: "application/json", body: '{"errors":[{"message":"withheld"}]}' });
      if (url.includes("/graphql/")) return route.fulfill({ contentType: "application/json", body: '{"data":{"ok":true}}' });
      return route.fulfill({ contentType: "text/html", body: HARNESS });
  });
}
