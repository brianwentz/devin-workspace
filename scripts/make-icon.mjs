// Generates build/icon.ico (256/128/64/48/32/16 px) with no external deps.
// The artwork is drawn procedurally: a rounded navy square with a white "D"
// ring opening — good enough as a placeholder until design assets exist.
// 16–128 px entries are stored as 32-bpp DIBs (maximum compatibility with
// NSIS/rcedit/Explorer); the 256 px entry is PNG-compressed as Windows expects.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'build', 'icon.ico');
const sizes = [256, 128, 64, 48, 32, 16];

const BG = [0x11, 0x18, 0x27]; // #111827 (matches the shell background)
const FG = [0xf9, 0xfa, 0xfb]; // #f9fafb
const ACCENT = [0x60, 0xa5, 0xfa]; // #60a5fa

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crc32Table();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Returns RGBA pixels (top-down) for a size.
function render(size) {
  const px = new Uint8Array(size * size * 4);
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const ringOuter = size * 0.34;
  const ringInner = size * 0.2;
  const ss = 4; // supersampling per axis
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss;
          const fy = y + (sy + 0.5) / ss;
          // rounded-rect coverage
          const dx = Math.max(Math.abs(fx - cx) - (size / 2 - radius), 0);
          const dy = Math.max(Math.abs(fy - cy) - (size / 2 - radius), 0);
          const inside = dx * dx + dy * dy <= radius * radius;
          if (!inside) continue;
          let c = BG;
          const d = Math.hypot(fx - cx, fy - cy);
          // "D" shape: ring, with the left side flattened into a bar.
          const inRing = d <= ringOuter && d >= ringInner && fx >= cx - size * 0.06;
          const inBar =
            fx >= cx - ringOuter && fx <= cx - ringOuter + (ringOuter - ringInner) &&
            Math.abs(fy - cy) <= ringOuter;
          if (inRing || inBar) c = FG;
          // accent dot (status indicator) bottom-right
          if (Math.hypot(fx - size * 0.76, fy - size * 0.76) <= size * 0.09) c = ACCENT;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      if (a > 0) {
        const covered = a / 255;
        px[i] = Math.round(r / covered);
        px[i + 1] = Math.round(g / covered);
        px[i + 2] = Math.round(b / covered);
        px[i + 3] = Math.round(a / n);
      }
    }
  }
  return px;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND masks
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(size * size * 4, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }
  const andStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(andStride * size); // all zero: alpha channel rules
  return Buffer.concat([header, xor, and]);
}

const images = sizes.map((size) => {
  const rgba = render(size);
  return { size, data: size >= 256 ? encodePng(size, rgba) : encodeDib(size, rgba) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // ICO
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = [];
for (const image of images) {
  const entry = Buffer.alloc(16);
  entry[0] = image.size >= 256 ? 0 : image.size;
  entry[1] = image.size >= 256 ? 0 : image.size;
  entry[2] = 0; // palette
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.data.length;
  entries.push(entry);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
console.log(`wrote ${output} (${offset} bytes, sizes ${sizes.join('/')})`);
