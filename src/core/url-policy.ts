const MEDIA_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com", "abs.twimg.com"]);
const MAX_URL_LENGTH = 2048;

function parse(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Sources are untrusted, so only X's own media CDNs may reach the page. */
export function isAllowedMediaUrl(value: unknown): value is string {
  const url = parse(value);
  return url !== null && url.protocol === "https:" && MEDIA_HOSTS.has(url.hostname);
}

/** Rejects `javascript:` and friends before a link can reach X's renderer. */
export function isWebUrl(value: unknown): value is string {
  const url = parse(value);
  return url !== null && (url.protocol === "https:" || url.protocol === "http:");
}
