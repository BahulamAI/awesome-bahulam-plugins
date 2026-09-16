/**
 * frame_scene — auto-position the camera to frame all (or specified) nodes.
 *
 * Uses measure_bounds internally, then picks a distance = size / (2 tan(fov/2)).
 *
 * Args:
 *   slug*    - scene slug
 *   ids      - node ids to frame (defaults to all)
 *   padding  - multiplier on distance (default 1.4)
 *   azimuth  - camera azimuth in degrees (default 30) — rotation around Y
 *   elevation - camera elevation in degrees (default 20)
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';
import { call as measureBounds } from './measure-bounds.mjs';

export async function call(args = {}, options = {}) {
  const { slug, ids, padding = 1.4, azimuth = 30, elevation = 20, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };

  const bounds = await measureBounds({ slug, ids, cwd });
  if (!bounds.success) return bounds;
  const { center, size } = bounds.output;
  const maxDim = Math.max(size[0], size[1], size[2], 0.001);
  const fovRad = ((scene.camera?.fov || 45) * Math.PI) / 180;
  const distance = (maxDim / (2 * Math.tan(fovRad / 2))) * padding;

  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const x = center[0] + distance * Math.cos(el) * Math.sin(az);
  const y = center[1] + distance * Math.sin(el);
  const z = center[2] + distance * Math.cos(el) * Math.cos(az);

  scene.camera = scene.camera || {};
  scene.camera.position = [x, y, z];
  scene.camera.target = center;
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { camera: scene.camera, bounds: bounds.output, html_path: paths.html } };
}
