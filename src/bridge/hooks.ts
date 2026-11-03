import type { RequestContext } from "../core/withheld-detector";

export interface BodyRewriter {
  rewrite(text: string, ctx: RequestContext): Promise<string>;
  /** True when this request's error response should be replaced too. */
  takesOverErrors(ctx: RequestContext): boolean;
}

type Json = Record<string, unknown>;

// The classic client calls /i/api/graphql/<id>/<Op>, the Relay client api.x.com/graphql/<id>/<Op>.
const GRAPHQL_PATH = /\/graphql\/[^/?#]+\/([A-Za-z0-9_]+)\/?$/;

function parseJsonObject(raw: unknown): Json {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

export function parseGraphqlRequest(url: string, body: unknown, base: string): RequestContext | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  const operation = parsed.pathname.match(GRAPHQL_PATH)?.[1];
  if (!operation) return null;
  const fromQuery = parsed.searchParams.get("variables");
  const variables = fromQuery ? parseJsonObject(fromQuery) : parseJsonObject(body).variables;
  return { operation, variables: typeof variables === "object" && variables !== null ? (variables as Json) : {} };
}

async function replaceFetchBody(response: Response, ctx: RequestContext, rewriter: BodyRewriter): Promise<Response> {
  if (!response.ok && !rewriter.takesOverErrors(ctx)) return response;
  try {
    const original = await response.clone().text();
    const next = await rewriter.rewrite(original, { ...ctx, transport: "fetch", status: response.status });
    if (next === original) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    const replaced = new Response(next, {
      status: response.ok ? response.status : 200,
      statusText: response.ok ? response.statusText : "OK",
      headers,
    });
    Object.defineProperty(replaced, "url", { value: response.url });
    return replaced;
  } catch {
    return response;
  }
}

/** Only GraphQL responses are read, and the original passes through unless something was recovered. */
export function installFetchHook(win: Window & typeof globalThis, rewriter: BodyRewriter): void {
  const nativeFetch = win.fetch;
  win.fetch = function hookedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const ctx = parseGraphqlRequest(url, init?.body, win.location.href);
    const pending = nativeFetch.call(win, input, init);
    return ctx ? pending.then((response) => replaceFetchBody(response, ctx, rewriter)) : pending;
  } as typeof fetch;
}

const HELD_EVENTS = ["readystatechange", "load", "loadend"] as const;

/**
 * Delays completion events until the body is rewritten. The gate is registered in
 * the constructor so it runs before every page listener and `on*` handler, whatever
 * order the page attaches them in. No request header is read or stored.
 */
export function installXhrHook(win: Window & typeof globalThis, rewriter: BodyRewriter): void {
  const NativeXhr = win.XMLHttpRequest;
  const released = new WeakSet<Event>();

  class HookedXhr extends NativeXhr {
    #url = "";
    #watch = false;
    #ctx: RequestContext | null = null;
    #phase: "waiting" | "holding" | "released" = "waiting";
    #held: string[] = [];
    #rewritten: string | undefined;
    #errorReplaced = false;
    #generation = 0;

    constructor() {
      super();
      const gate = (event: Event) => this.#gate(event);
      for (const type of HELD_EVENTS) super.addEventListener(type, gate, true);
    }

    #reset(): void {
      this.#generation += 1;
      this.#ctx = null;
      this.#phase = "waiting";
      this.#held = [];
      this.#rewritten = undefined;
      this.#errorReplaced = false;
    }

    override open(method: string, url: string | URL, async = true, username?: string | null, password?: string | null): void {
      this.#reset();
      this.#url = String(url);
      // A synchronous request cannot wait for a rewrite, so it is left alone.
      this.#watch = async !== false;
      super.open(method, url, async, username, password);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (this.#watch) this.#ctx = parseGraphqlRequest(this.#url, body, win.location.href);
      super.send(body);
    }

    override abort(): void {
      this.#reset();
      super.abort();
    }

    #readBody(): string | null {
      if (this.responseType === "" || this.responseType === "text") return super.responseText;
      if (this.responseType === "json") return JSON.stringify(super.response);
      return null;
    }

    #gate(event: Event): void {
      if (!this.#ctx || this.#phase === "released" || released.has(event)) return;
      if (this.#phase === "waiting") {
        if (event.type !== "readystatechange" || this.readyState !== 4) return;
        const status = super.status;
        const failed = status < 200 || status >= 300;
        // Status 0 means the request never completed, so its error events pass through.
        if (status === 0 || (failed && !rewriter.takesOverErrors(this.#ctx))) return;
        const body = this.#readBody();
        if (body === null) return;
        this.#phase = "holding";
        void this.#process(body, this.#ctx, this.#generation);
      }
      event.stopImmediatePropagation();
      this.#held.push(event.type);
    }

    async #process(body: string, ctx: RequestContext, generation: number): Promise<void> {
      let next: string;
      try {
        next = await rewriter.rewrite(body, { ...ctx, transport: "xhr", status: super.status });
      } catch {
        next = body;
      }
      if (generation !== this.#generation) return;
      if (next !== body) {
        this.#rewritten = next;
        this.#errorReplaced = super.status < 200 || super.status >= 300;
      }
      this.#phase = "released";
      for (const type of this.#held.splice(0)) {
        const event = type === "readystatechange" ? new Event(type) : new ProgressEvent(type);
        released.add(event);
        this.dispatchEvent(event);
      }
    }

    override get status(): number {
      return this.#errorReplaced ? 200 : super.status;
    }

    override get statusText(): string {
      return this.#errorReplaced ? "OK" : super.statusText;
    }

    override get responseText(): string {
      return this.#rewritten ?? super.responseText;
    }

    override get response(): unknown {
      if (this.#rewritten === undefined) return super.response;
      return this.responseType === "json" ? JSON.parse(this.#rewritten) : this.#rewritten;
    }
  }

  Object.defineProperty(HookedXhr, "name", { value: "XMLHttpRequest" });
  win.XMLHttpRequest = HookedXhr;
}
