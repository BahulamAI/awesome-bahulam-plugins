/**
 * reparent_node — move a node under a different parent (or the scene root).
 *
 * Args:
 *   slug*   - scene slug
 *   id*     - node id to move
 *   parent  - new parent node id, or empty string / null to detach to root
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, id, parent, cwd } = args;
  if (!slug || !id) return { success: false, output: '`slug` and `id` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const node = scene.nodes?.find(n => n.id === id);
  if (!node) return { success: false, output: `Node "${id}" not found.` };
  if (parent) {
    const p = scene.nodes.find(n => n.id === parent);
    if (!p) return { success: false, output: `Parent "${parent}" not found.` };
    if (parent === id) return { success: false, output: 'Cannot parent node to itself.' };
    node.parent = parent;
  } else {
    delete node.parent;
  }
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { id, parent: node.parent || null, html_path: paths.html } };
}
