/**
 * render-report for threejs-studio — evidence report for a scene.
 */
import { rows, appendEvent } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const { slug } = args;
  const state = await (options?.state || Promise.resolve(null));

  const inventory = { scenes: 0, jobs: 0, approvals: 0 };
  const scenes = [];

  if (state && typeof state.query === 'function') {
    try {
      if (slug) {
        const sceneRows = state.query('SELECT * FROM threejs_scenes WHERE slug = ?', [slug]);
        for (const r of sceneRows || []) {
          scenes.push({
            id: r.id, slug: r.slug, title: r.title, path: r.html_path,
            status: r.status, width: r.width, height: r.height,
            created_at: r.created_at, updated_at: r.updated_at,
          });
        }
        const jobRows = state.query('SELECT * FROM threejs_jobs WHERE slug = ? ORDER BY id DESC', [slug]);
        inventory.jobs = (jobRows || []).length;
        const approvalRows = state.query('SELECT * FROM threejs_approvals WHERE slug = ? ORDER BY id DESC', [slug]);
        inventory.approvals = (approvalRows || []).length;
      } else {
        const all = state.query('SELECT * FROM threejs_scenes ORDER BY id DESC', []);
        for (const r of all || []) scenes.push({
          id: r.id, slug: r.slug, title: r.title, path: r.html_path, status: r.status,
          created_at: r.created_at,
        });
      }
    } catch { /* fall through */ }
  }

  // Fall back to stream
  if (!scenes.length && state && typeof state.list === 'function') {
    try {
      const streamRows = state.list('scenes', { limit: 20 });
      for (const r of streamRows || []) {
        scenes.push({
          id: r.id,
          slug: r.payload?.name || r.name,
          title: r.payload?.title || r.title,
          path: r.payload?.path || r.path,
          status: r.payload?.status || r.status || 'unknown',
          created_at: r.created_at,
        });
      }
    } catch { /* skip */ }
  }

  inventory.scenes = scenes.length;
  const ready = scenes.length > 0 && scenes.some(s => s.status === 'completed');

  return {
    success: true,
    output: {
      ready_for_user: ready,
      inventory,
      scenes,
    },
  };
}