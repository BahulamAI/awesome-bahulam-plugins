/**
 * add_keyframe — add / extend an animation clip with keyframe data.
 *
 * The first call for a given clip creates it; subsequent calls with the
 * same clip_id append tracks.
 *
 * Args:
 *   slug*     - scene slug
 *   target*   - node id the animation drives
 *   clip_id   - clip identifier (auto-gen if omitted)
 *   duration  - clip length in seconds (default 2)
 *   loop      - default true
 *   property* - dotted path relative to target — ".position", ".rotation",
 *               ".scale", ".quaternion", ".material.opacity"
 *   times*    - array of keyframe times in seconds
 *   values*   - flat array of values (Vector3: [x,y,z,x,y,z,...]; Quat:
 *               [x,y,z,w,...]; scalar: [v,v,...])
 *   interpolation - optional (currently informational)
 *   cwd
 */
import { loadScene, genId } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, target, clip_id, duration = 2, loop = true, property, times, values, interpolation, cwd } = args;
  if (!slug || !target || !property || !Array.isArray(times) || !Array.isArray(values)) {
    return { success: false, output: '`slug`, `target`, `property`, `times[]`, `values[]` required.' };
  }
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  if (!scene.nodes.find(n => n.id === target)) return { success: false, output: `Node "${target}" not found.` };

  scene.animations = scene.animations || [];
  const id = clip_id || genId({ nodes: scene.animations.map(a => ({ id: a.id })), materials: {} }, 'clip');
  let clip = scene.animations.find(c => c.id === id && c.target === target);
  if (!clip) {
    clip = { id, target, duration, loop, tracks: [] };
    scene.animations.push(clip);
  } else {
    clip.duration = Math.max(clip.duration || 0, duration);
    clip.loop = loop;
  }
  clip.tracks.push({ property, times, values, ...(interpolation ? { interpolation } : {}) });
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { clip_id: id, tracks: clip.tracks.length, html_path: paths.html } };
}
