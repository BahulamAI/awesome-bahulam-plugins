/**
 * list-renders tool for threejs-studio — lists saved scenes and outcomes.
 */
import { rows, appendEvent } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const { limit = 20 } = args;
  const state = await (options?.state || Promise.resolve(null));

  const scenes = [];

  // Try SQL state
  if (state && typeof state.query === 'function') {
    try {
      const sqlRows = state.query(
        `SELECT * FROM threejs_scenes ORDER BY id DESC LIMIT ?`,
        [Math.min(limit, 100)],
      );
      for (const r of sqlRows || []) {
        scenes.push({
          id: r.id,
          slug: r.slug,
          title: r.title,
          path: r.html_path,
          status: r.status,
          width: r.width,
          height: r.height,
          created_at: r.created_at,
        });
      }
    } catch { /* fall through */ }
  }

  // Fall back to stream state
  if (!scenes.length && state && typeof state.list === 'function') {
    try {
      const streamRows = state.list('scenes', { limit });
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

  return {
    success: true,
    output: `Found ${scenes.length} three.js scene(s).`,
    renders: scenes,
  };
}