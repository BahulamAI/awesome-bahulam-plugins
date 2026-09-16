/**
 * add_light — add or replace a light node.
 *
 * Args:
 *   slug*      - scene slug
 *   id         - node id (auto-generated if omitted)
 *   type*      - "ambient" | "directional" | "point" | "spot" | "hemisphere" | "rectarea"
 *   color      - "#rrggbb"
 *   intensity  - number
 *   position   - [x,y,z]
 *   target     - [x,y,z] (directional/spot)
 *   distance / decay / angle / penumbra - type-specific
 *   groundColor  - hemisphere-only
 *   width / height - rectarea-only
 *   castShadow  - bool
 *   shadowMapSize - int (default 1024)
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './scene-io.mjs';
import { genId } from './lib.mjs';

const LIGHT_TYPES = new Set(['ambient', 'directional', 'point', 'spot', 'hemisphere', 'rectarea']);

export async function call(args = {}, options = {}) {
  const {
    slug, id, type, color = '#ffffff', intensity = 1,
    position, target, distance, decay, angle, penumbra,
    groundColor, width, height,
    castShadow, shadowMapSize, cwd, title,
  } = args;
  if (!slug || !type) return { success: false, output: '`slug` and `type` required.' };
  if (!LIGHT_TYPES.has(type)) return { success: false, output: `\`type\` must be one of: ${[...LIGHT_TYPES].join(', ')}` };

  const scene = await loadOrCreate({ slug, title, cwd });
  const lightId = id || genId(scene, 'l');

  const light = { type, color, intensity };
  if (position) light.position = position;
  if (target) light.target = target;
  if (distance != null) light.distance = distance;
  if (decay != null) light.decay = decay;
  if (angle != null) light.angle = angle;
  if (penumbra != null) light.penumbra = penumbra;
  if (groundColor) light.groundColor = groundColor;
  if (width != null) light.width = width;
  if (height != null) light.height = height;
  if (castShadow) light.castShadow = true;
  if (shadowMapSize) light.shadowMapSize = shadowMapSize;

  scene.nodes = scene.nodes || [];
  const existing = scene.nodes.findIndex(n => n.id === lightId);
  const node = { id: lightId, type: 'light', light };
  if (existing >= 0) scene.nodes[existing] = node; else scene.nodes.push(node);

  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { id: lightId, light, html_path: paths.html } };
}
