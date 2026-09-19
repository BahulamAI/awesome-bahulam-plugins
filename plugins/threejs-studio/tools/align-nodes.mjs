/**
 * align_nodes — align a set of nodes to a common axis-plane, or distribute
 * them along an axis with even spacing.
 *
 * Uses each node's `position` in local space. For accurate alignment against
 * geometry bounds, run measure_bounds first — this tool only touches
 * `position`, not pivots.
 *
 * Args:
 *   slug*   - scene slug
 *   ids*    - array of node ids (>=2)
 *   axis*   - "x" | "y" | "z"
 *   mode*   - "min" | "center" | "max" | "distribute"
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, ids, axis, mode, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  if (!Array.isArray(ids) || ids.length < 2) return { success: false, output: '`ids` must be an array of at least 2 node ids.' };
  if (!['x', 'y', 'z'].includes(axis)) return { success: false, output: '`axis` must be x, y, or z.' };
  if (!['min', 'center', 'max', 'distribute'].includes(mode)) return { success: false, output: '`mode` must be min, center, max, or distribute.' };

  const axisIdx = { x: 0, y: 1, z: 2 }[axis];
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };

  const targets = ids.map(id => scene.nodes?.find(n => n.id === id));
  if (targets.some(n => !n)) {
    const missing = ids.filter(id => !scene.nodes?.find(n => n.id === id));
    return { success: false, output: `Nodes not found: ${missing.join(', ')}` };
  }

  targets.forEach(n => { if (!n.position) n.position = [0, 0, 0]; });
  const values = targets.map(n => n.position[axisIdx]);

  if (mode === 'distribute') {
    const sorted = targets
      .map((n, i) => ({ n, v: values[i] }))
      .sort((a, b) => a.v - b.v);
    const min = sorted[0].v;
    const max = sorted[sorted.length - 1].v;
    const step = (max - min) / (sorted.length - 1);
    sorted.forEach((s, i) => { s.n.position[axisIdx] = min + step * i; });
  } else {
    let target;
    if (mode === 'min') target = Math.min(...values);
    else if (mode === 'max') target = Math.max(...values);
    else target = values.reduce((a, b) => a + b, 0) / values.length;
    targets.forEach(n => { n.position[axisIdx] = target; });
  }

  const paths = await saveAndSync(scene, cwd, options);
  return {
    success: true,
    output: {
      axis, mode,
      updated: targets.map(n => ({ id: n.id, position: n.position })),
      html_path: paths.html,
    },
  };
}
