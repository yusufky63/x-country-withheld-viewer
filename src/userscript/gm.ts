/** The parts of the userscript manager API this script uses, as Tampermonkey and Violentmonkey define them. */

export interface GmInfo {
  scriptHandler?: string;
  /** Tampermonkey: "raw", "js" or "dom". */
  sandboxMode?: string;
  /** Violentmonkey: "page" or "content". */
  injectInto?: string;
}

export interface GmResponse {
  status: number;
  responseText?: string;
  responseHeaders?: string;
}

export interface GmRequestDetails {
  method: "GET";
  url: string;
  anonymous: boolean;
  timeout: number;
  headers: Record<string, string>;
  onload(response: GmResponse): void;
  onerror(): void;
  ontimeout(): void;
  onabort(): void;
}

export type GmRequest = (details: GmRequestDetails) => unknown;
export type GmGetValue = <T>(key: string, fallback: T) => T;
export type GmMenuId = string | number;

export const sandboxModeOf = (info: GmInfo): string | undefined => info.sandboxMode ?? info.injectInto;

/**
 * Reading X's responses takes the page's own `fetch` and XHR, which code in a separate
 * sandbox cannot wrap. A manager that reports no mode is given the chance to work.
 */
export function runsInPageWorld(info: GmInfo): boolean {
  const mode = sandboxModeOf(info);
  return mode === undefined || mode === "raw" || mode === "page";
}
