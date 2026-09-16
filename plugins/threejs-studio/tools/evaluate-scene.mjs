/**
 * evaluate_scene — critique a scene via the configured VLM provider.
 *
 * If no screenshots are supplied, it takes some first (via render_screenshot)
 * when puppeteer is available. Otherwise the critic runs on the scene DSL
 * alone (heuristic pass/fail — the local provider's mode).
 *
 * Args:
 *   slug*        - scene slug
 *   criteria     - free-text description of what "good" means
 *   screenshots  - paths to PNGs; if omitted, captured on demand
 *   provider     - override THREEJS_VLM_PROVIDER for this call
 *   cwd
 *
 * Returns { provider, pass, issues[], wins[], next_steps[], shots }
 */
import { loadScene, appendEvent, nowIso } from './lib.mjs';
import { chooseProvider, loadProvider } from './providers/index.mjs';
import { call as renderScreenshot } from './render-screenshot.mjs';

export async function call(args = {}, options = {}) {
  const { slug, criteria, screenshots, provider, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const scene = loadScene(slug, cwd);
  if (!scene) return { success: false, output: `Scene "${slug}" not found.` };

  let shots = screenshots;
  let mode = 'supplied';
  if (!shots || shots.length === 0) {
    const shotResult = await renderScreenshot({ slug, cwd }, options);
    if (shotResult.success && Array.isArray(shotResult.output.shots)) {
      shots = shotResult.output.shots.map(s => s.path);
      mode = shotResult.output.mode || 'captured';
    } else {
      shots = [];
      mode = 'no-shots';
    }
  }

  const providerName = chooseProvider('vlm', provider);
  const impl = await loadProvider('vlm', providerName);
  const verdict = await impl.evaluate({ scene, images: (shots || []).map(p => ({ path: p })), criteria });

  const state = options?.state ? await options.state : null;
  if (state) {
    appendEvent(state, 'critiques', {
      slug, provider: verdict.provider, pass: verdict.pass,
      issue_count: (verdict.issues || []).length, at: nowIso(),
    });
  }

  return { success: true, output: { ...verdict, shots, mode, slug } };
}
