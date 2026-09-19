/**
 * set_exposure — set tone mapping and exposure.
 *
 * Args:
 *   slug*     - scene slug
 *   exposure  - number (default 1.0). Higher = brighter.
 *   mapping   - "None" | "Linear" | "Reinhard" | "Cineon" | "ACESFilmic" (default)
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './scene-io.mjs';

const MAPPINGS = new Set(['None', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic']);

export async function call(args = {}, options = {}) {
  const { slug, exposure, mapping, cwd, title } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  if (mapping && !MAPPINGS.has(mapping)) return { success: false, output: `\`mapping\` must be one of: ${[...MAPPINGS].join(', ')}` };

  const scene = await loadOrCreate({ slug, title, cwd });
  scene.tone = scene.tone || { mapping: 'ACESFilmic', exposure: 1.0 };
  if (exposure != null) scene.tone.exposure = Number(exposure);
  if (mapping) scene.tone.mapping = mapping;
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { tone: scene.tone, html_path: paths.html } };
}
