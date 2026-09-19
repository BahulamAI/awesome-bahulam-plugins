/**
 * set_environment — set the scene background/environment map.
 *
 * Args:
 *   slug*      - scene slug
 *   hdri       - path to .hdr file (relative to scene folder or absolute URL)
 *   color      - solid background "#rrggbb" (mutually exclusive with hdri)
 *   intensity  - env map intensity multiplier (default 1)
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, hdri, color, intensity = 1, cwd, title } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  if (!hdri && !color) return { success: false, output: 'Provide either `hdri` or `color`.' };
  if (hdri && color) return { success: false, output: '`hdri` and `color` are mutually exclusive.' };

  const scene = await loadOrCreate({ slug, title, cwd });
  scene.background = hdri ? { hdri, intensity } : color;
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { background: scene.background, html_path: paths.html } };
}
