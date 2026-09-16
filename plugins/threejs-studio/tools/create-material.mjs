/**
 * create_material — define a material in scene.materials.
 *
 * Args:
 *   slug*     - scene slug
 *   id*       - material id (used by nodes' materialId field)
 *   type      - "standard" | "physical" | "basic" | "lambert" | "phong" | "toon" | "normal" | "points" | "line"  (default "standard")
 *   color     - "#rrggbb" or CSS color
 *   roughness / metalness / emissive / emissiveIntensity - PBR params
 *   opacity / transparent / side / wireframe             - common params
 *   clearcoat / transmission / ior / thickness           - MeshPhysicalMaterial only
 *   map / normalMap / roughnessMap / metalnessMap / emissiveMap / aoMap / alphaMap
 *              - texture paths (relative to the scene folder)
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './scene-io.mjs';

const MAT_TYPES = new Set(['standard', 'physical', 'basic', 'lambert', 'phong', 'toon', 'normal', 'points', 'line']);
const OPTIONAL = [
  'color', 'emissive', 'emissiveIntensity', 'opacity', 'transparent', 'side', 'wireframe',
  'roughness', 'metalness', 'envMapIntensity',
  'clearcoat', 'transmission', 'ior', 'thickness',
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap',
];

export async function call(args = {}, options = {}) {
  const { slug, id, type = 'standard', cwd, title, width, height } = args;
  if (!slug || !id) return { success: false, output: '`slug` and `id` required.' };
  if (!MAT_TYPES.has(type)) return { success: false, output: `\`type\` must be one of: ${[...MAT_TYPES].join(', ')}` };

  const scene = await loadOrCreate({ slug, title, width, height, cwd });
  scene.materials = scene.materials || {};
  const mat = { type };
  for (const k of OPTIONAL) if (args[k] != null) mat[k] = args[k];
  scene.materials[id] = mat;
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { id, type, material: mat, html_path: paths.html } };
}
