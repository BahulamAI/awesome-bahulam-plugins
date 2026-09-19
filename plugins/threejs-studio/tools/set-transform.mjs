/**
 * set_transform — mutate position/rotation/scale on a node.
 *
 * Args:
 *   slug*     - scene slug
 *   id*       - node id
 *   position  - [x,y,z]  (omit to leave unchanged)
 *   rotation  - [x,y,z]  (radians)
 *   scale     - [x,y,z]
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, id, position, rotation, scale, cwd } = args;
  if (!slug || !id) return { success: false, output: '`slug` and `id` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const node = scene.nodes?.find(n => n.id === id);
  if (!node) return { success: false, output: `Node "${id}" not found.` };
  if (position) node.position = position;
  if (rotation) node.rotation = rotation;
  if (scale) node.scale = scale;
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { id, position: node.position, rotation: node.rotation, scale: node.scale, html_path: paths.html } };
}
