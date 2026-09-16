/**
 * add_script — attach a small piece of JS to a node/event.
 *
 * The code runs inside a closure with these variables in scope:
 *   target  — the Three.js Object3D matched by `target` id
 *   scene   — the root THREE.Scene
 *   dt      — delta seconds (tick event only)
 *   hit     — first raycast intersection (click/hover events)
 *   THREE   — the Three.js namespace
 *
 * SECURITY: the code runs client-side, in the compiled HTML page's JS
 * context. Treat scenes as trusted input — do not load untrusted scenes.
 *
 * Args:
 *   slug*    - scene slug
 *   target*  - node id (id in _byId; scene root not supported)
 *   event*   - "tick" | "click" | "hover"
 *   code*    - JS body (no wrapping function needed)
 *   id       - script id (auto-gen)
 *   cwd
 */
import { loadScene, genId } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

const EVENTS = new Set(['tick', 'click', 'hover']);

export async function call(args = {}, options = {}) {
  const { slug, target, event, code, id, cwd } = args;
  if (!slug || !target || !event || !code) {
    return { success: false, output: '`slug`, `target`, `event`, `code` required.' };
  }
  if (!EVENTS.has(event)) return { success: false, output: `\`event\` must be one of: ${[...EVENTS].join(', ')}` };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  if (!scene.nodes.find(n => n.id === target)) return { success: false, output: `Node "${target}" not found.` };

  const scriptId = id || genId(scene, 's');
  scene.scripts = scene.scripts || [];
  scene.scripts.push({ id: scriptId, target, event, code });
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { id: scriptId, target, event, html_path: paths.html } };
}
