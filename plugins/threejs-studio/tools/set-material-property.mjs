/**
 * set_material_property — patch one or more fields on an existing material.
 *
 * Args:
 *   slug*   - scene slug
 *   id*     - material id
 *   patch*  - object of fields to merge (color, roughness, metalness, map, ...)
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

const ALLOWED = new Set([
  'type', 'color', 'emissive', 'emissiveIntensity', 'opacity', 'transparent', 'side', 'wireframe',
  'roughness', 'metalness', 'envMapIntensity',
  'clearcoat', 'transmission', 'ior', 'thickness',
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap',
]);

export async function call(args = {}, options = {}) {
  const { slug, id, patch, cwd } = args;
  if (!slug || !id || !patch || typeof patch !== 'object') {
    return { success: false, output: '`slug`, `id`, and `patch` (object) required.' };
  }
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const mat = scene.materials?.[id];
  if (!mat) return { success: false, output: `Material "${id}" not found.` };
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) continue;
    if (v == null) delete mat[k]; else mat[k] = v;
  }
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { id, material: mat, html_path: paths.html } };
}
