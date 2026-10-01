import { deflateSync } from 'node:zlib';

// Canvas-free taskbar badge renderer: a filled circle with a 1–9 / "9+" label,
// encoded as an RGBA PNG. No runtime dependencies beyond node:zlib.

const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

export function badgeLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, Buffer.from(data), crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('rgba buffer size mismatch');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((value, index) => {
      raw[y * (width * 4 + 1) + 1 + index] = value;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface BadgeOptions {
  size?: number;
  background?: [number, number, number];
  foreground?: [number, number, number];
}

export function renderBadgePng(count: number, options: BadgeOptions = {}): Buffer {
  const size = options.size ?? 32;
  const bg = options.background ?? [0xd9, 0x3a, 0x2f];
  const fg = options.foreground ?? [0xff, 0xff, 0xff];
  const rgba = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // 1px anti-aliased edge.
      const coverage = Math.max(0, Math.min(1, radius - distance + 0.5));
      if (coverage <= 0) continue;
      const offset = (y * size + x) * 4;
      rgba[offset] = bg[0];
      rgba[offset + 1] = bg[1];
      rgba[offset + 2] = bg[2];
      rgba[offset + 3] = Math.round(coverage * 255);
    }
  }
  const label = badgeLabel(count);
  if (label) {
    const scale = label.length === 1 ? Math.max(1, Math.floor(size / 8)) : Math.max(1, Math.floor(size / 11));
    const gap = label.length === 1 ? 0 : scale;
    const glyphWidth = 3 * scale;
    const glyphHeight = 5 * scale;
    const totalWidth = label.length * glyphWidth + (label.length - 1) * gap;
    const startX = Math.round((size - totalWidth) / 2);
    const startY = Math.round((size - glyphHeight) / 2);
    [...label].forEach((char, index) => {
      const glyph = GLYPHS[char];
      if (!glyph) return;
      const originX = startX + index * (glyphWidth + gap);
      glyph.forEach((row, gy) => {
        [...row].forEach((cell, gx) => {
          if (cell !== '1') return;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              const px = originX + gx * scale + sx;
              const py = startY + gy * scale + sy;
              if (px < 0 || py < 0 || px >= size || py >= size) continue;
              const offset = (py * size + px) * 4;
              rgba[offset] = fg[0];
              rgba[offset + 1] = fg[1];
              rgba[offset + 2] = fg[2];
              rgba[offset + 3] = 255;
            }
          }
        });
      });
    });
  }
  return encodePng(size, size, rgba);
}

export function badgeDataUrl(count: number, options?: BadgeOptions): string {
  return `data:image/png;base64,${renderBadgePng(count, options).toString('base64')}`;
}
