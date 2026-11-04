// Serves the built userscript locally, because a manager offers to install any URL ending in .user.js.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USERSCRIPT_FILE } from "./userscript-header.mjs";

const PORT = 8127;
const path = `/${USERSCRIPT_FILE}`;
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-userscript", USERSCRIPT_FILE);

createServer(async (request, response) => {
  if (request.url === "/") {
    response.writeHead(302, { location: path }).end();
    return;
  }
  if (request.url !== path) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(body);
  } catch {
    response.writeHead(500).end("Run pnpm build first.");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Open http://127.0.0.1:${PORT}${path} with Tampermonkey or Violentmonkey installed.`);
});
