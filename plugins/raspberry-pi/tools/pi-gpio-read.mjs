import { nowIso, resolveState, runOnBoard, sanitizePin, getSimPin } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  const pin = sanitizePin(args.pin);
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');

  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);

  let level;
  let raw;

  if (board.target_kind === 'virtual') {
    const sim = getSimPin(state, boardId, pin);
    if (sim?.fault === 'read_fails') {
      const failId = state.query(
        `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
         VALUES (?, 'read', ?, ?, 'failed', 0, ?)`,
        [boardId, pin, 'simulated read failure (fault=read_fails)', nowIso()],
      );
      state.append('pi_activity', { type: 'pi_action_recorded', board_id: boardId, action_id: Number(failId.lastInsertRowid), action: 'read', pin, status: 'failed' });
      throw new Error(`simulated read failure on pin ${pin} (fault=read_fails, seeded via pi_sim_seed)`);
    }
    level = sim ? Number(sim.level) : 0;
    raw = `sim level=${level}`;
  } else {
    const result = await runOnBoard(board, 'pinctrl', ['get', String(pin)], options);
    level = /\bhi\b/i.test(result.stdout) ? 1 : 0;
    raw = result.stdout.trim();
  }

  const inserted = state.query(
    `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
     VALUES (?, 'read', ?, ?, 'completed', 0, ?)`,
    [boardId, pin, `level=${level}`, nowIso()],
  );
  state.append('pi_activity', { type: 'pi_action_recorded', board_id: boardId, action_id: Number(inserted.lastInsertRowid), action: 'read', pin, status: 'completed' });

  return { success: true, output: { board_id: boardId, pin, level, raw } };
}
