import { appendActivity, nowIso, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const title = String(args.title || '').trim();
    const objective = String(args.objective || '').trim();
    const owner = String(args.owner || '').trim();
    if (!title || !objective) {
      return { success: false, output: 'title and objective are required.' };
    }
    const ts = nowIso();
    const info = run(state, 'INSERT INTO work_items (title, objective, status, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      title,
      objective,
      'open',
      owner,
      ts,
      ts,
    ]);
    const id = Number(info.lastInsertRowid || 0);
    state.set?.('runtime_state', { active_work_item_id: id, title, status: 'open' });
    appendActivity(state, 'work_item_created', { work_item_id: id, title });
    return { success: true, output: { work_item_id: id, title, objective, owner, status: 'open' } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
