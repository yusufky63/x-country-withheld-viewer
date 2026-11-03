#!/usr/bin/env node
// Checks whether public sources can return a withheld post. Sends only post IDs, with
// no cookies or tokens. Node 20+.
//   node tools/probe.mjs <withheldTweetId> [rootTweetId] [handle]

const [withheldId, rootId, handle = "i"] = process.argv.slice(2);
if (!/^\d+$/.test(withheldId ?? "")) {
  console.error("Usage: node tools/probe.mjs <withheldTweetId> [rootTweetId] [handle]");
  process.exit(1);
}

async function get(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    const body = await response.json().catch(() => null);
    return { http: response.status, body };
  } catch (error) {
    return { http: 0, body: null, error: error.name };
  }
}

function describeStatus(status, requestedId) {
  if (!status) return "no status in response";
  if (status.type === "tombstone") return `tombstone (${status.reason ?? "unknown"})`;
  const idCheck = status.id === requestedId ? "ID matches" : `ID MISMATCH: ${status.id}`;
  return `real content, ${idCheck}, @${status.author?.screen_name}, media ${status.media?.all?.length ?? 0}: ${JSON.stringify((status.text ?? "").slice(0, 80))}`;
}

async function report(label, url, read) {
  const { http, body, error } = await get(url);
  console.log(`\n${label}\n  ${url}\n  HTTP ${http}${error ? ` (${error})` : ""}${body?.code ? `, code ${body.code}` : ""}`);
  if (body) console.log(`  ${read(body)}`);
}

const conversation = (id) => (body) =>
  `${describeStatus(body.status, id)}\n  replies on page: ${body.replies?.length ?? 0}, next cursor: ${body.cursor?.bottom ? "yes" : "no"}`;

await report("FxTwitter status", `https://api.fxtwitter.com/2/status/${withheldId}`, (body) => describeStatus(body.status, withheldId));
await report("FxTwitter conversation (post)", `https://api.fxtwitter.com/2/conversation/${withheldId}`, conversation(withheldId));
if (rootId) {
  await report("FxTwitter conversation (root)", `https://api.fxtwitter.com/2/conversation/${rootId}`, conversation(rootId));
}
await report("x.md JSON", `https://mdfromx.com/${handle}/status/${withheldId}?format=json`, (body) =>
  describeStatus(body.posts?.find((post) => post.id === withheldId), withheldId),
);
