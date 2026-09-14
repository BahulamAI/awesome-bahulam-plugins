import { nowIso, resolveState } from './lib.mjs';

const SENSITIVE_ACTIONS = new Set(['submit']);

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const sessionId = Number(args.session_id);
  const action = String(args.action || '').trim();
  const status = String(args.status || '').trim();
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('session_id must be a positive integer');
  if (!action) throw new Error('action is required');
  if (!status) throw new Error('status is required');

  const requiresApproval = Boolean(args.requires_approval) || SENSITIVE_ACTIONS.has(action);
  const selector = String(args.selector || '');
  const valueSummary = String(args.value_summary || '').slice(0, 240);
  const result = state.query(
    `INSERT INTO browser_actions (session_id, action, selector, value_summary, status, requires_approval, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, action, selector, valueSummary, status, requiresApproval ? 1 : 0, nowIso()],
  );
  state.query(
    `UPDATE browser_sessions SET status = ?, updated_at = ? WHERE id = ?`,
    [status === 'failed' ? 'blocked' : status, nowIso(), sessionId],
  );
  state.append('browser_activity', {
    type: 'browser_action_recorded',
    session_id: sessionId,
    action_id: Number(result.lastInsertRowid),
    action,
    status,
    requires_approval: requiresApproval,
  });

  return {
    success: true,
    output: {
      action_id: Number(result.lastInsertRowid),
      session_id: sessionId,
      action,
      status,
      requires_approval: requiresApproval,
    },
  };
}
