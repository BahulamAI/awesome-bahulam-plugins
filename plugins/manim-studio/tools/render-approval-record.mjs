import { appendEvent, appendStream, nowIso, rows, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const slug = String(args.slug || args.name || '').trim().toLowerCase();
  const reviewer = String(args.reviewer || 'user').trim();
  const decision = String(args.decision || '').trim();
  const allowed = new Set(['approved', 'rejected', 'changes_requested']);
  if (!slug || !reviewer || !allowed.has(decision)) {
    return { success: false, output: 'slug, reviewer, and decision approved|rejected|changes_requested are required.' };
  }

  const state = await stateOf(options);
  if (!state) {
    return { success: false, output: 'Shared blackboard unavailable in this context.' };
  }

  const ts = nowIso();
  const scene = rows(state, 'SELECT id FROM render_scenes WHERE slug = ? ORDER BY id DESC LIMIT 1', [slug])[0] || null;
  const payload = {
    slug,
    scene_id: scene ? scene.id : null,
    reviewer,
    decision,
    notes: String(args.notes || '').trim().slice(0, 1000),
    approved_script_path: String(args.approved_script_path || '').trim(),
    created_at: ts,
  };
  const info = run(state, `INSERT INTO render_approvals
    (scene_id, slug, reviewer, decision, notes, approved_script_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    payload.scene_id,
    payload.slug,
    payload.reviewer,
    payload.decision,
    payload.notes,
    payload.approved_script_path,
    payload.created_at,
  ]);
  appendStream(state, 'render_approvals', payload);
  appendEvent(state, 'render_approval_recorded', { slug, reviewer, decision });

  return {
    success: true,
    output: {
      approval_id: Number(info?.lastInsertRowid || 0),
      ...payload,
    },
  };
}
