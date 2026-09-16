/**
 * decimate_mesh — record a decimation intent for an asset.
 *
 * v0.2 does not perform mesh decimation in-process (needs three-mesh-bvh
 * or gltf-transform). Instead, this tool records the intent as
 * scene.assets[id].decimation = { target_tris }. A downstream Phase 3
 * offline pass will actually reduce the mesh; until then the note is
 * surfaced in list_assets output.
 *
 * Args:
 *   slug*         - scene slug
 *   asset_id*     - id in scene.assets
 *   target_tris*  - target triangle count
 *   cwd
 */
import { loadScene } from './lib.mjs';
import { saveAndSync } from './scene-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, asset_id, target_tris, cwd } = args;
  if (!slug || !asset_id || target_tris == null) {
    return { success: false, output: '`slug`, `asset_id`, `target_tris` required.' };
  }
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };
  scene.assets = scene.assets || {};
  if (!scene.assets[asset_id]) return { success: false, output: `Asset "${asset_id}" not found.` };
  scene.assets[asset_id].decimation = { target_tris: Number(target_tris), status: 'pending' };
  const paths = await saveAndSync(scene, cwd, options);
  return {
    success: true,
    output: {
      asset_id,
      decimation: scene.assets[asset_id].decimation,
      note: 'v0.2 records intent only. Actual mesh reduction requires Phase 3 offline pass (gltf-transform).',
      html_path: paths.html,
    },
  };
}
