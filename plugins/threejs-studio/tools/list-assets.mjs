/**
 * list_assets — return the asset manifest for a scene.
 *
 * Args:
 *   slug*  - scene slug
 *   kind   - filter: "mesh" | "texture" | "gltf" | "hdri"
 *   cwd
 */
import { loadScene } from './lib.mjs';

export async function call(args = {}) {
  const { slug, kind, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const entries = Object.entries(scene.assets || {})
    .filter(([, a]) => !kind || a.kind === kind)
    .map(([id, a]) => ({ id, ...a }));
  return { success: true, output: { count: entries.length, assets: entries } };
}
