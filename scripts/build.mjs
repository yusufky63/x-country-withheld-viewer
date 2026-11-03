import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

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
  define: { __EXTENSION_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(root, "public/manifest.json"), "utf8")).version) },
};

const fonts = {
  "dm-sans-400.woff2": "@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2",
  "dm-sans-500.woff2": "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2",
  "jetbrains-mono-400.woff2": "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
};

function copyStatic() {
  cpSync(join(root, "public"), dist, { recursive: true });
  mkdirSync(join(dist, "fonts"), { recursive: true });
  for (const [name, source] of Object.entries(fonts)) {
    cpSync(join(root, "node_modules", source), join(dist, "fonts", name));
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log("Watching src/. Reload the extension in chrome://extensions after a change.");
} else {
  await esbuild.build(options);
}
