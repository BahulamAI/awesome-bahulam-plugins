/**
 * render-approval-record for threejs-studio — persists approval decisions.
 */
import { nowIso, appendEvent } from './lib.mjs';

const VALID_DECISIONS = new Set(['approved', 'rejected', 'changes_requested']);

export async function call(args = {}, options = {}) {
  const { slug, reviewer, decision, notes = '', approved_script_path = '' } = args;

  if (!slug) return { success: false, output: '`slug` is required.' };
  if (!reviewer) return { success: false, output: '`reviewer` is required.' };
  if (!decision || !VALID_DECISIONS.has(decision)) {
    return { success: false, output: `Invalid decision "${decision}". Use: ${[...VALID_DECISIONS].join(', ')}` };
  }

  const state = await (options?.state || Promise.resolve(null));
  if (!state) {
    return { success: false, output: 'No state available — approval recorded in-memory only.' };
  }

  if (typeof state.query === 'function') {
    try {
      state.query(
        `INSERT INTO threejs_approvals (slug, reviewer, decision, notes, approved_script_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [slug, reviewer, decision, notes, approved_script_path, nowIso()],
      );
    } catch { /* skip */ }
  }

  appendEvent(state, 'approvals', { slug, reviewer, decision, notes, approved_script_path, created_at: nowIso() });

  return { success: true, output: `Approval "${decision}" for "${slug}" recorded.` };
}