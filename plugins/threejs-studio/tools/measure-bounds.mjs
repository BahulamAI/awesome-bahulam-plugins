/**
 * measure_bounds — approximate axis-aligned bounds for one or more nodes.
 *
 * Bounds are computed from geometry primitive params + node position/scale.
 * For gltf nodes the tool returns an approximate 1x1x1 box unless a manual
 * `bounds` field is present on the node.
 *
 * Args:
 *   slug*   - scene slug
 *   ids     - array of node ids (defaults: all nodes)
 *   cwd
 *
 * Returns:
 *   { bounds: { min:[x,y,z], max:[x,y,z], center:[...], size:[...] } }
 */
import { loadScene } from './lib.mjs';

function primitiveExtents(node) {
  const g = node.geometry;
  const t = g?.type ? String(g.type).toLowerCase() : '';
  const p = g?.params || g || {};
  const scl = node.scale || [1, 1, 1];
  const pos = node.position || [0, 0, 0];
  let half = [0.5, 0.5, 0.5]; // default box unit
  switch (t) {
    case 'box':
      half = [(+p.width || 1) / 2, (+p.height || 1) / 2, (+p.depth || 1) / 2];
      break;
    case 'sphere': {
      const r = +p.radius || 1;
      half = [r, r, r];
      break;
    }
    case 'cylinder':
    case 'cone': {
      const r = Math.max(+p.radiusTop || 0, +p.radiusBottom || +p.radius || 1);
      const h = +p.height || 1;
      half = [r, h / 2, r];
      break;
    }
    case 'torus':
    case 'torusknot': {
      const r = (+p.radius || 1) + (+p.tube || 0.4);
      half = [r, r, r];
      break;
    }
    case 'plane':
      half = [(+p.width || 1) / 2, (+p.height || 1) / 2, 0.001];
      break;
    case 'circle': {
      const r = +p.radius || 1;
      half = [r, r, 0.001];
      break;
    }
    default:
      half = [0.5, 0.5, 0.5];
  }
  const scaled = half.map((h, i) => h * (scl[i] ?? 1));
  return {
    min: [pos[0] - scaled[0], pos[1] - scaled[1], pos[2] - scaled[2]],
    max: [pos[0] + scaled[0], pos[1] + scaled[1], pos[2] + scaled[2]],
  };
}

function boundsForNode(node) {
  if (node.bounds && node.bounds.min && node.bounds.max) return node.bounds;
  if (['mesh', 'points', 'line', 'instanced'].includes(node.type)) return primitiveExtents(node);
  // gltf/group/light/helper/sprite: unknown extent
  const pos = node.position || [0, 0, 0];
  return { min: pos.slice(), max: pos.slice() };
}

function combine(a, b) {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export async function call(args = {}) {
  const { slug, ids, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  const targetIds = Array.isArray(ids) && ids.length
    ? ids
    : (scene.nodes || []).map(n => n.id);
  const targets = targetIds
    .map(id => scene.nodes?.find(n => n.id === id))
    .filter(Boolean);
  if (!targets.length) return { success: false, output: 'No matching nodes.' };
  let bounds = boundsForNode(targets[0]);
  for (let i = 1; i < targets.length; i++) bounds = combine(bounds, boundsForNode(targets[i]));
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
  const center = [(bounds.max[0] + bounds.min[0]) / 2, (bounds.max[1] + bounds.min[1]) / 2, (bounds.max[2] + bounds.min[2]) / 2];
  return { success: true, output: { bounds, size, center, node_ids: targets.map(n => n.id) } };
}
