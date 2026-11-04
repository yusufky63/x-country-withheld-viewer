const REPOSITORY = "https://github.com/yusufky63/x-country-withheld-viewer";
export const USERSCRIPT_FILE = "x-country-withheld-viewer.user.js";

// A fixed asset name makes this link follow every new release, which is what updates rely on.
const DOWNLOAD_URL = `${REPOSITORY}/releases/latest/download/${USERSCRIPT_FILE}`;

const GRANTS = [
  "unsafeWindow",
  "GM_xmlhttpRequest",
  "GM_getValue",
  "GM_setValue",
  "GM_addValueChangeListener",
  "GM_addStyle",
  "GM_setClipboard",
  "GM_registerMenuCommand",
];

/**
 * Matches and connect hosts come from the manifest, so the two builds cannot drift apart.
 * `sandbox` and `inject-into` ask each manager for the page world, which the hooks need.
 */
export function userscriptHeader({ manifest, description, descriptionTr, iconDataUri }) {
  const fields = [
    ["name", "X Country Withheld Viewer"],
    ["namespace", "https://github.com/yusufky63"],
    ["version", manifest.version],
    ["description", description],
    ["description:tr", descriptionTr],
    ["author", "yusufky63"],
    ["license", "MIT"],
    ["homepageURL", REPOSITORY],
    ["supportURL", `${REPOSITORY}/issues`],
    ["downloadURL", DOWNLOAD_URL],
    ["updateURL", DOWNLOAD_URL],
    ["icon", iconDataUri],
    ...manifest.content_scripts[0].matches.map((match) => ["match", match]),
    ...manifest.host_permissions.map((host) => ["connect", new URL(host.replace("*", "")).hostname]),
    ...GRANTS.map((grant) => ["grant", grant]),
    ["run-at", "document-start"],
    ["sandbox", "raw"],
    ["inject-into", "page"],
    ["noframes"],
  ];
  const lines = fields.map(([key, value]) => `// @${key.padEnd(16)}${value ?? ""}`.trimEnd());
  return ["// ==UserScript==", ...lines, "// ==/UserScript=="].join("\n");
}
