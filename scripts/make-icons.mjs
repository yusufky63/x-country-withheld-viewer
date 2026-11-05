// Rasterizes the toolbar icon into PNGs with no image dependency, so the icons can
// be regenerated anywhere Node runs: `pnpm icons`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SAMPLES = 4;
const BRAND = [3, 112, 253];
const WHITE = [255, 255, 255];

function inRoundedSquare(x, y) {
  const inset = Math.abs(x) - 0.82;
  const insetY = Math.abs(y) - 0.82;
  return Math.hypot(Math.max(inset, 0), Math.max(insetY, 0)) <= 0.18 && inset <= 0.18 && insetY <= 0.18;
}

/** An eye: two overlapping circles form the lens, with a pupil cut into it. */
function inEye(x, y) {
  const radius = 0.86;
  const offset = 0.46;
  const inLens = Math.hypot(x, y - offset) <= radius && Math.hypot(x, y + offset) <= radius;
  const distance = Math.hypot(x, y);
  return inLens && !(distance > 0.2 && distance <= 0.34);
}

function pixel(column, row, size, margin) {
  const art = size - margin * 2;
  let covered = 0;
  let glyph = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = ((column - margin + (sx + 0.5) / SAMPLES) / art) * 2 - 1;
      const y = ((row - margin + (sy + 0.5) / SAMPLES) / art) * 2 - 1;
      if (!inRoundedSquare(x, y)) continue;
      covered += 1;
      if (inEye(x, y)) glyph += 1;
    }
  }
  const total = SAMPLES * SAMPLES;
  const mix = covered === 0 ? 0 : glyph / covered;
  return [...BRAND.map((value, index) => Math.round(value + (WHITE[index] - value) * mix)), Math.round((covered / total) * 255)];
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(size, margin) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let cursor = 0;
  for (let y = 0; y < size; y += 1) {
    raw[cursor++] = 0;
    for (let x = 0; x < size; x += 1) {
      for (const value of pixel(x, y, size, margin)) {
        raw[cursor++] = value;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
// The store wants 96px of art on the 128px icon. The toolbar sizes fill their whole square.
for (const [size, margin] of [[16, 0], [32, 0], [48, 0], [128, 16]]) {
  writeFileSync(join(out, `icon-${size}.png`), png(size, margin));
}
