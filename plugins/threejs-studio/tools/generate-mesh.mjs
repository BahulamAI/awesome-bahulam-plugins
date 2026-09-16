/**
 * generate_mesh — text→3D via the configured mesh provider.
 *
 * Providers (env THREEJS_MESH_PROVIDER):
 *   local  (default) — writes a placeholder primitive .gltf into assets/.
 *   meshy            — requires MESHY_API_KEY. Writes a real .glb.
 *
 * Args:
 *   slug*    - scene slug
 *   prompt*  - text description
 *   id       - stable asset id (default: derived from prompt hash)
 *   provider - override THREEJS_MESH_PROVIDER for this call
 *   seed     - deterministic gen seed (provider-dependent)
 *   register_node - if true, also add a `gltf` node referencing the asset (default true)
 *   node_id  - id for the created node
 *   parent   - parent node
 *   position - [x,y,z] for the node
 *   cwd
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { loadOrCreate, saveAndSync } from './scene-io.mjs';
import { chooseProvider, loadProvider } from './providers/index.mjs';
import { resolveSceneDir, genId } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const {
    slug, prompt, id, provider, seed,
    register_node = true, node_id, parent, position,
    cwd, title,
  } = args;
  if (!slug || !prompt) return { success: false, output: '`slug` and `prompt` required.' };

  const scene = await loadOrCreate({ slug, title, cwd });
  const sceneDir = resolveSceneDir(slug, cwd);

  const providerName = chooseProvider('mesh', provider);
  const impl = await loadProvider('mesh', providerName);

  const assetId = id || `mesh_${crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
  const result = await impl.generateMesh({ prompt, sceneDir, id: assetId, seed });
  if (result.error) return { success: false, output: result };

  scene.assets = scene.assets || {};
  scene.assets[assetId] = {
    kind: 'mesh',
    path: result.asset_path,
    provider: result.provider,
    prompt,
    ...(result.primitive ? { placeholder: result.primitive } : {}),
  };

  let nodeIdOut;
  if (register_node) {
    nodeIdOut = node_id || genId(scene, 'a');
    if (!scene.nodes.some(n => n.id === nodeIdOut)) {
      scene.nodes.push({
        id: nodeIdOut, type: 'gltf', asset: result.asset_path,
        ...(parent ? { parent } : {}),
        ...(position ? { position } : {}),
      });
    }
  }

  const paths = await saveAndSync(scene, cwd, options);
  return {
    success: true,
    output: {
      asset_id: assetId,
      provider: result.provider,
      asset_path: result.asset_path,
      node_id: nodeIdOut || null,
      note: result.note,
      html_path: paths.html,
    },
  };
}
