// Zips `dist` for the store with the manifest at the root and forward slashes in every
// path, using no dependency: `pnpm package`. Entries carry a fixed date, so the same build
// always gives the same bytes.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const DOS_DATE_1980_01_01 = 0x0021;

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.version !== version) {
  throw new Error(`manifest.json says ${manifest.version} and package.json says ${version}`);
}

const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join("/"))
  .sort();

const locals = [];
const centrals = [];
let offset = 0;
for (const name of files) {
  const data = readFileSync(join(dist, name));
  const compressed = deflateRawSync(data, { level: 9 });
  const path = Buffer.from(name, "utf8");

  const shared = Buffer.alloc(26);
  shared.writeUInt16LE(20, 0);
  shared.writeUInt16LE(0x0800, 2); // The names are UTF-8.
  shared.writeUInt16LE(8, 4); // Deflate.
  shared.writeUInt16LE(0, 6);
  shared.writeUInt16LE(DOS_DATE_1980_01_01, 8);
  shared.writeUInt32LE(crc32(data), 10);
  shared.writeUInt32LE(compressed.length, 14);
  shared.writeUInt32LE(data.length, 18);
  shared.writeUInt16LE(path.length, 22);
  shared.writeUInt16LE(0, 24);

  const localHead = Buffer.alloc(4);
  localHead.writeUInt32LE(0x04034b50);
  const local = Buffer.concat([localHead, shared, path, compressed]);
  locals.push(local);

  const centralHead = Buffer.alloc(6);
  centralHead.writeUInt32LE(0x02014b50);
  centralHead.writeUInt16LE(20, 4);
  const centralTail = Buffer.alloc(14);
  centralTail.writeUInt32LE(offset, 10);
  centrals.push(Buffer.concat([centralHead, shared, centralTail, path]));
  offset += local.length;
}

const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);

const out = join(root, `x-country-withheld-viewer-${version}.zip`);
writeFileSync(out, Buffer.concat([...locals, central, end]));
console.log(`${relative(root, out)}: ${files.length} files`);
