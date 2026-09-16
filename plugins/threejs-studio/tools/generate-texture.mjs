/**
 * generate_texture — text→image via the configured texture provider.
 *
 * Providers (env THREEJS_TEXTURE_PROVIDER):
 *   local (default) — writes a solid-color .png that matches keyword palette.
 *   fal             — requires FAL_KEY. Calls Flux Schnell.
 *
 * Args:
 *   slug*    - scene slug
 *   prompt*  - text description
 *   id       - stable asset id (default: prompt hash)
 *   size     - pixel size (default 512)
 *   provider - override THREEJS_TEXTURE_PROVIDER
 *   apply_to - material id to apply as `map` (optional)
 *   cwd
 */
import crypto from 'node:crypto';
import { loadOrCreate, saveAndSync } from './scene-io.mjs';
import { chooseProvider, loadProvider } from './providers/index.mjs';
import { resolveSceneDir } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const { slug, prompt, id, size = 512, provider, apply_to, cwd, title } = args;
  if (!slug || !prompt) return { success: false, output: '`slug` and `prompt` required.' };

  const scene = await loadOrCreate({ slug, title, cwd });
  const sceneDir = resolveSceneDir(slug, cwd);

  const providerName = chooseProvider('texture', provider);
  const impl = await loadProvider('texture', providerName);

  const assetId = id || `tex_${crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
  const result = await impl.generateTexture({ prompt, sceneDir, id: assetId, size });
  if (result.error) return { success: false, output: result };

  scene.assets = scene.assets || {};
  scene.assets[assetId] = {
    kind: 'texture',
    path: result.asset_path,
    provider: result.provider,
    prompt,
    ...(result.color_rgb ? { color_rgb: result.color_rgb } : {}),
  };

  if (apply_to) {
    scene.materials = scene.materials || {};
    scene.materials[apply_to] = scene.materials[apply_to] || { type: 'standard' };
    scene.materials[apply_to].map = result.asset_path;
  }

  const paths = await saveAndSync(scene, cwd, options);
  return {
    success: true,
    output: {
      asset_id: assetId,
      provider: result.provider,
      asset_path: result.asset_path,
      applied_to: apply_to || null,
      note: result.note,
      html_path: paths.html,
    },
  };
}
