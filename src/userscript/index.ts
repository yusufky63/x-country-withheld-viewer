import { DIAGNOSTICS_KEY } from "../background/diagnostics-log";
import { createRecoveryService } from "../background/recovery-service";
import { claimPage, startPageRuntime } from "../bridge/page-runtime";
import { Marker } from "../content/marker";
import { type GmGetValue, type GmInfo, type GmMenuId, type GmRequest, runsInPageWorld, sandboxModeOf } from "./gm";
import { createGmJsonFetcher } from "./http";
import { createMemoryStore } from "./memory-store";
import { createSettingsMenu, readGmSettings } from "./menu";

declare const __EXTENSION_VERSION__: string;
declare const __MARKER_CSS__: string;
// With any grant, a manager gives the script a stand-in `window`. Hooks set on it would
// never reach X's code, so everything that has to touch the page goes through this.
declare const unsafeWindow: Window & typeof globalThis;
declare const GM_info: GmInfo;
declare const GM_xmlhttpRequest: GmRequest;
declare const GM_getValue: GmGetValue;
declare const GM_setValue: (key: string, value: unknown) => void;
declare const GM_addStyle: (css: string) => unknown;
declare const GM_setClipboard: (text: string) => void;
declare const GM_registerMenuCommand: (label: string, run: () => void, options: { id?: GmMenuId }) => GmMenuId;
declare const GM_addValueChangeListener: (key: string, listener: (key: string, before: unknown, after: unknown, remote: boolean) => void) => unknown;

const mode = sandboxModeOf(GM_info) ?? "unknown";
// How many scripts ran before this one tells from a report whether it started in time.
const build = `userscript ${__EXTENSION_VERSION__} ${GM_info.scriptHandler ?? "unknown"} mode=${mode} scripts=${document.scripts.length}`;

if (!runsInPageWorld(GM_info)) {
  console.warn(`[X Withheld Viewer] ${build} cannot read X's responses from this sandbox, so it stays off`);
} else if (claimPage(unsafeWindow, build)) {
  const store = createMemoryStore();
  const handle = createRecoveryService({
    fetchJson: createGmJsonFetcher(GM_xmlhttpRequest),
    store,
    getSettings: async () => readGmSettings(GM_getValue),
  });

  const marker = new Marker(document);

  // First, so that a manager failing on the style or the menu below cannot cost the recovery.
  startPageRuntime(unsafeWindow, {
    build,
    ask: handle,
    tell: (request) => void handle(request).catch(() => {}),
    mark: (applied, failed, profiles) => marker.add(applied, failed, profiles),
  });

  GM_addStyle(__MARKER_CSS__);

  createSettingsMenu({
    getValue: GM_getValue,
    setValue: GM_setValue,
    register: GM_registerMenuCommand,
    onValueChange: GM_addValueChangeListener,
    copy: GM_setClipboard,
    apply({ glowBorder, language }) {
      marker.setGlow(glowBorder);
      marker.setLanguage(language);
    },
    clearResults: () => handle({ type: "clear-cache" }),
    async diagnostics() {
      const lines = await store.get(DIAGNOSTICS_KEY);
      return [`X Country Withheld Viewer ${build}`, ...(Array.isArray(lines) ? (lines as string[]) : [])];
    },
  }).refresh();
}
