/**
 * set_camera — configure the scene camera.
 *
 * Args:
 *   slug*     - scene slug
 *   type      - "perspective" | "orthographic"
 *   fov       - degrees (perspective only)
 *   near / far - clip planes
 *   position  - [x,y,z]
 *   target    - [x,y,z] (look-at)
 *   controls  - "orbit" | "first-person" | "none"
 *   width     - orthographic half-width
 *   height    - orthographic half-height
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, type, fov, near, far, position, target, controls, width, height, cwd, title } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const scene = await loadOrCreate({ slug, title, cwd });
  scene.camera = scene.camera || {};
  if (type) scene.camera.type = type;
  if (fov != null) scene.camera.fov = fov;
  if (near != null) scene.camera.near = near;
  if (far != null) scene.camera.far = far;
  if (position) scene.camera.position = position;
  if (target) scene.camera.target = target;
  if (controls) scene.camera.controls = controls;
  if (width != null) scene.camera.width = width;
  if (height != null) scene.camera.height = height;
  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { camera: scene.camera, html_path: paths.html } };
}
