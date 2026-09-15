import { nowIso, resolveState } from './lib.mjs';

const APPROVAL_ACTIONS = new Set(['write', 'pwm']);

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  const action = String(args.action || '').trim();
  const status = String(args.status || '').trim();
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');
  if (!action) throw new Error('action is required');
  if (!status) throw new Error('status is required');

  const board = state.query('SELECT id FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);

  const requiresApproval = Boolean(args.requires_approval) || (APPROVAL_ACTIONS.has(action) && status !== 'completed');
  const pin = args.pin === undefined || args.pin === null ? null : Number(args.pin);
  const valueSummary = String(args.value_summary || '').slice(0, 240);

  const result = state.query(
    `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [boardId, action, pin, valueSummary, status, requiresApproval ? 1 : 0, nowIso()],
  );
  state.append('pi_activity', {
    type: 'pi_action_recorded',
    board_id: boardId,
    action_id: Number(result.lastInsertRowid),
    action,
    status,
    requires_approval: requiresApproval,
  });

  return {
    success: true,
    output: { action_id: Number(result.lastInsertRowid), board_id: boardId, action, status, requires_approval: requiresApproval },
  };
}
