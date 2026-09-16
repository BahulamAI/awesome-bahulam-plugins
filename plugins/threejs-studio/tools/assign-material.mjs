/**
 * assign_material — set materialId on one or more nodes.
 *
 * Args:
 *   slug*         - scene slug
 *   node_ids*     - array of node ids
 *   material_id*  - material id (must exist in scene.materials)
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

const ASSIGNABLE_TYPES = new Set(['mesh', 'instanced', 'points', 'line', 'sprite']);

export async function call(args = {}, options = {}) {
  const { slug, node_ids, material_id, cwd } = args;
  if (!slug || !material_id || !Array.isArray(node_ids) || !node_ids.length) {
    return { success: false, output: '`slug`, `node_ids` (array), and `material_id` required.' };
  }
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  if (!scene.materials?.[material_id]) return { success: false, output: `Material "${material_id}" not found.` };

  const missing = [];
  const skipped = [];
  const updated = [];
  for (const id of node_ids) {
    const node = scene.nodes?.find(n => n.id === id);
    if (!node) { missing.push(id); continue; }
    if (!ASSIGNABLE_TYPES.has(node.type)) { skipped.push(id); continue; }
    node.materialId = material_id;
    updated.push(id);
  }
  if (updated.length === 0) {
    return { success: false, output: { message: 'No nodes updated.', missing, skipped } };
  }
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { material_id, updated, missing, skipped, html_path: paths.html } };
}
