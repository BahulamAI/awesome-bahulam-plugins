/**
 * add_physics_body — attach a cannon-es rigid body to a node.
 *
 * Args:
 *   slug*     - scene slug
 *   target*   - node id the body drives
 *   shape*    - "box" | "sphere" | "plane"
 *   mass      - kg (0 = static). Default 1 for boxes/spheres, 0 for plane.
 *   halfExtents - [hx,hy,hz] (box only). Default [0.5,0.5,0.5].
 *   radius    - m (sphere only). Default 0.5.
 *   position  - initial body position; defaults to node.position or [0,0,0].
 *   restitution - bounce (0-1). Default 0.
 *   friction  - 0-1. Default 0.4.
 *   id        - body id (auto-gen if omitted)
 *   cwd
 */
import { loadScene, genId } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

const SHAPES = new Set(['box', 'sphere', 'plane']);

export async function call(args = {}, options = {}) {
  const { slug, target, shape, mass, halfExtents, radius, position, restitution, friction, id, cwd } = args;
  if (!slug || !target || !shape) return { success: false, output: '`slug`, `target`, `shape` required.' };
  if (!SHAPES.has(shape)) return { success: false, output: `\`shape\` must be one of: ${[...SHAPES].join(', ')}` };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const node = scene.nodes?.find(n => n.id === target);
  if (!node) return { success: false, output: `Node "${target}" not found.` };

  const bodyId = id || genId(scene, 'body');
  const body = {
    id: bodyId,
    target,
    shape,
    mass: mass != null ? Number(mass) : (shape === 'plane' ? 0 : 1),
    position: position || node.position || [0, 0, 0],
  };
  if (halfExtents) body.halfExtents = halfExtents;
  if (radius != null) body.radius = Number(radius);
  if (restitution != null) body.restitution = Number(restitution);
  if (friction != null) body.friction = Number(friction);

  scene.physics = scene.physics || [];
  scene.physics.push(body);
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { body, html_path: paths.html } };
}
