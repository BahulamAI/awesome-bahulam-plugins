/**
 * register-render tool for threejs-studio — records a completed/failed scene.
 */
import { nowIso, appendEvent } from './lib.mjs';

const VALID_STATUSES = new Set(['completed', 'failed', 'fixed_and_rerendered']);

export async function call(args = {}, options = {}) {
  const { name, status, html_path = '', notes = '' } = args;

  if (!name) return { success: false, output: '`name` (slug) is required.' };
  if (!status || !VALID_STATUSES.has(status)) {
    return { success: false, output: `Invalid status "${status}". Use one of: ${[...VALID_STATUSES].join(', ')}` };
  }

  const state = await (options?.state || Promise.resolve(null));
  if (!state) {
    return { success: false, output: 'No state available — scene registered in-memory only.' };
  }

  // Update SQL state
  if (typeof state.query === 'function') {
    try {
      state.query(
        `UPDATE threejs_scenes SET status = ?, updated_at = ? WHERE slug = ?`,
        [status, nowIso(), name],
      );
      state.query(
        `INSERT INTO threejs_jobs (slug, status, html_path, notes, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, status, html_path, notes, nowIso(), nowIso()],
      );
    } catch { /* skip */ }
  }

  appendEvent(state, 'renders', { name, status, html_path, notes, created_at: nowIso() });

  return { success: true, output: `Render ${status} for "${name}" registered.` };
}