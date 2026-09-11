import { appendActivity, nowIso, one, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const workItemId = Number(args.work_item_id);
    const kind = String(args.kind || '').trim();
    const summary = String(args.summary || '').trim();
    const artifactPath = String(args.artifact_path || '').trim();
    if (!Number.isInteger(workItemId) || workItemId <= 0 || !kind || !summary) {
      return { success: false, output: 'work_item_id, kind, and summary are required.' };
    }
    const item = one(state, 'SELECT * FROM work_items WHERE id = ?', [workItemId]);
    if (!item) return { success: false, output: `Work item not found: ${workItemId}` };
    const ts = nowIso();
    const info = run(state, 'INSERT INTO outcomes (work_item_id, kind, summary, artifact_path, created_at) VALUES (?, ?, ?, ?, ?)', [
      workItemId,
      kind,
      summary,
      artifactPath,
      ts,
    ]);
    run(state, 'UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?', ['done', ts, workItemId]);
    state.patch?.('runtime_state', { active_work_item_id: workItemId, status: 'done' });
    appendActivity(state, 'outcome_recorded', { work_item_id: workItemId, kind, artifact_path: artifactPath });
    return { success: true, output: { outcome_id: Number(info.lastInsertRowid || 0), work_item_id: workItemId, kind, summary, artifact_path: artifactPath } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
