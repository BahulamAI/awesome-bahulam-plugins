/**
 * delete_node — remove a node (and optionally its descendants) from the scene.
 *
 * Args:
 *   slug*      - scene slug
 *   id*        - node id
 *   recursive  - also remove descendants (default true)
 *   cwd
 */
import { loadScene, removeNode } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

function collectDescendants(scene, id) {
  const kids = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of scene.nodes || []) {
      if (n.parent === cur) { kids.push(n.id); stack.push(n.id); }
    }
  }
  return kids;
}

export async function call(args = {}, options = {}) {
  const { slug, id, recursive = true, cwd } = args;
  if (!slug || !id) return { success: false, output: '`slug` and `id` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  if (!scene.nodes?.find(n => n.id === id)) {
    return { success: false, output: `Node "${id}" not found.` };
  }
  const targets = recursive ? [id, ...collectDescendants(scene, id)] : [id];
  for (const t of targets) removeNode(scene, t);
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { removed: targets, html_path: paths.html } };
}
