/**
 * fal.ai texture provider (Flux Schnell). Text→image at 512-1024.
 *
 * Requires FAL_KEY. Falls back to local if missing.
 * Endpoint may change; caller can override with FAL_ENDPOINT.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateTexture as fallback } from './texture-local.mjs';

const DEFAULT_ENDPOINT = 'https://fal.run/fal-ai/flux/schnell';

export async function generateTexture({ prompt, sceneDir, id, size = 512 }) {
  const key = process.env.FAL_KEY;
  if (!key) {
    const stub = await fallback({ prompt, sceneDir, id, size });
    return { ...stub, provider: 'local (FAL_KEY missing)' };
  }
  const endpoint = process.env.FAL_ENDPOINT || DEFAULT_ENDPOINT;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: 'square_hd', num_images: 1 }),
  }).then(r => r.json());
  const url = r?.images?.[0]?.url;
  if (!url) return { provider: 'fal', error: 'no image url returned', response: r };
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const filename = `fal_tex_${id || Date.now().toString(36)}.png`;
  const assetsDir = path.join(sceneDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const dst = path.join(assetsDir, filename);
  fs.writeFileSync(dst, buf);
  return {
    provider: 'fal',
    prompt,
    asset_path: path.relative(sceneDir, dst),
    asset_absolute: dst,
  };
}
