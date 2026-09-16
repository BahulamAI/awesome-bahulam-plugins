/**
 * Local texture provider — writes a solid-color PNG that encodes the
 * prompt's dominant color (or a picked palette). Zero deps: hand-rolled
 * uncompressed PNG so we don't need `sharp` at install time.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const PALETTES = [
  { match: /(wood|oak|walnut|cedar)/i, color: [138, 96, 60] },
  { match: /(stone|concrete|granite)/i, color: [136, 136, 136] },
  { match: /(metal|steel|chrome|iron)/i, color: [180, 180, 190] },
  { match: /(gold|brass|copper)/i, color: [212, 175, 55] },
  { match: /(leather|red)/i, color: [139, 26, 26] },
  { match: /(grass|foliage|green|leaf)/i, color: [92, 138, 62] },
  { match: /(water|ocean|blue)/i, color: [30, 90, 160] },
  { match: /(sand|beach)/i, color: [214, 184, 130] },
  { match: /(snow|white)/i, color: [244, 244, 246] },
  { match: /(dark|night|black)/i, color: [30, 30, 36] },
];

function pickColor(prompt) {
  for (const p of PALETTES) if (p.match.test(prompt || '')) return p.color;
  return [128, 128, 140];
}

/** Encode a solid-color RGBA PNG (size x size). No external deps. */
function encodeSolidPNG(color, size = 64) {
  const [r, g, b] = color;
  const width = size, height = size;
  const rowStride = width * 4 + 1; // 1 byte filter per row
  const raw = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowStride;
    raw[off] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw);

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    const crcInput = Buffer.concat([typeBuf, data]);
    crc.writeInt32BE(crc32(crcInput), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// CRC-32 (PNG spec). Small, standalone.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return c ^ -1;
}

export async function generateTexture({ prompt, sceneDir, id, size = 128 }) {
  const color = pickColor(prompt);
  const shortId = id || crypto.randomBytes(4).toString('hex');
  const filename = `local_tex_${shortId}.png`;
  const assetsDir = path.join(sceneDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const dst = path.join(assetsDir, filename);
  fs.writeFileSync(dst, encodeSolidPNG(color, size));
  return {
    provider: 'local',
    prompt,
    color_rgb: color,
    asset_path: path.relative(sceneDir, dst),
    asset_absolute: dst,
    note: 'placeholder solid color — configure THREEJS_TEXTURE_PROVIDER=fal (+FAL_KEY) for real generation',
  };
}
