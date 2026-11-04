import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { USERSCRIPT_FILE, userscriptHeader } from "./userscript-header.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
// Kept apart from dist, which is the folder people load as an unpacked extension.
const userscriptDist = join(root, "dist-userscript");
const watch = process.argv.includes("--watch");
const manifest = JSON.parse(readFileSync(join(root, "public/manifest.json"), "utf8"));
const locale = (language) => JSON.parse(readFileSync(join(root, "public/_locales", language, "messages.json"), "utf8"));

// Content scripts cannot be ES modules, so every entry is a standalone IIFE.
const options = {
  entryPoints: {
    background: join(root, "src/background/index.ts"),
    content: join(root, "src/content/index.ts"),
    bridge: join(root, "src/bridge/main-world.ts"),
    popup: join(root, "src/popup/popup.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome111",
  charset: "utf8",
  // bridge.js is parsed on every load of X, before X's own code runs.
  minify: !watch,
  legalComments: "none",
  logLevel: "info",
  // The page world has no extension API, so its version line gets the number at build time.
  define: { __EXTENSION_VERSION__: JSON.stringify(manifest.version) },
};

const userscriptOptions = {
  entryPoints: [join(root, "src/userscript/index.ts")],
  outfile: join(userscriptDist, USERSCRIPT_FILE),
  bundle: true,
  format: "iife",
  target: ["chrome111", "firefox128"],
  charset: "utf8",
  // Left readable on purpose: people should be able to read a script that runs on their X.
  legalComments: "none",
  logLevel: "info",
  banner: {
    js: userscriptHeader({
      manifest,
      description: locale("en").extDescription.message,
      descriptionTr: locale("tr").extDescription.message,
      iconDataUri: `data:image/png;base64,${readFileSync(join(root, "public/icons/icon-48.png")).toString("base64")}`,
    }),
  },
  define: {
    __EXTENSION_VERSION__: JSON.stringify(manifest.version),
    __MARKER_CSS__: JSON.stringify(readFileSync(join(root, "public/marker.css"), "utf8")),
  },
};

const fonts = {
  "dm-sans-400.woff2": "@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2",
  "dm-sans-500.woff2": "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2",
  "jetbrains-mono-400.woff2": "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  "dm-sans-ext-400.woff2": "@fontsource/dm-sans/files/dm-sans-latin-ext-400-normal.woff2",
  "dm-sans-ext-500.woff2": "@fontsource/dm-sans/files/dm-sans-latin-ext-500-normal.woff2",
  "jetbrains-mono-ext-400.woff2": "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-400-normal.woff2",
};

function copyStatic() {
  cpSync(join(root, "public"), dist, { recursive: true });
  mkdirSync(join(dist, "fonts"), { recursive: true });
  for (const [name, source] of Object.entries(fonts)) {
    cpSync(join(root, "node_modules", source), join(dist, "fonts", name));
  }
}

rmSync(dist, { recursive: true, force: true });
rmSync(userscriptDist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  await (await esbuild.context(userscriptOptions)).watch();
  console.log("Watching src/. Reload the extension in chrome://extensions after a change.");
} else {
  await esbuild.build(options);
  await esbuild.build(userscriptOptions);
}
