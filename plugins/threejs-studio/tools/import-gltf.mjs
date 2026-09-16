/**
 * import_gltf — register an existing .gltf / .glb asset and (optionally)
 * add it as a node.
 *
 * If `src` is an HTTPS URL, the file is downloaded into assets/. If it's
 * a local absolute path, it's copied. If it's already a relative path
 * inside the scene folder, it's just registered.
 *
 * Args:
 *   slug*    - scene slug
 *   src*     - URL or path to .gltf/.glb
 *   id       - asset id (default: filename stem)
 *   register_node - default true
 *   node_id  - id for the created node
 *   parent   - parent node id
 *   position/rotation/scale - transform for the node
 *   cwd
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreate, saveAndSync } from './scene-io.mjs';
import { resolveSceneDir, genId } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const {
    slug, src, id,
    register_node = true, node_id, parent, position, rotation, scale,
    cwd, title,
  } = args;
  if (!slug || !src) return { success: false, output: '`slug` and `src` required.' };

  const scene = await loadOrCreate({ slug, title, cwd });
  const sceneDir = resolveSceneDir(slug, cwd);
  const assetsDir = path.join(sceneDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  let assetPath;
  if (/^https?:\/\//i.test(src)) {
    const filename = path.basename(new URL(src).pathname) || `imported_${Date.now()}.glb`;
    const dst = path.join(assetsDir, filename);
    try {
      const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
      fs.writeFileSync(dst, buf);
    } catch (e) {
      return { success: false, output: `Download failed: ${e.message}` };
    }
    assetPath = path.relative(sceneDir, dst);
  } else if (path.isAbsolute(src)) {
    if (!fs.existsSync(src)) return { success: false, output: `File not found: ${src}` };
    const filename = path.basename(src);
    const dst = path.join(assetsDir, filename);
    fs.copyFileSync(src, dst);
    assetPath = path.relative(sceneDir, dst);
  } else {
    // relative — assume already in scene folder
    if (!fs.existsSync(path.join(sceneDir, src))) return { success: false, output: `Relative path not found: ${src}` };
    assetPath = src;
  }

  const assetId = id || path.basename(assetPath).replace(/\.[^.]+$/, '');
  scene.assets = scene.assets || {};
  scene.assets[assetId] = { kind: 'gltf', path: assetPath, provider: 'import' };

  let nodeIdOut;
  if (register_node) {
    nodeIdOut = node_id || genId(scene, 'g');
    const node = { id: nodeIdOut, type: 'gltf', asset: assetPath };
    if (parent) node.parent = parent;
    if (position) node.position = position;
    if (rotation) node.rotation = rotation;
    if (scale) node.scale = scale;
    scene.nodes.push(node);
  }

  const paths = await saveAndSync(scene, cwd, options);
  return { success: true, output: { asset_id: assetId, asset_path: assetPath, node_id: nodeIdOut || null, html_path: paths.html } };
}
