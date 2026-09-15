import { nowIso, resolveState, runOnBoard, sanitizePin, getSimPin, upsertSimPin } from './lib.mjs';

function record(state, boardId, action, pin, valueSummary, status, requiresApproval) {
  const result = state.query(
    `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [boardId, action, pin, valueSummary || '', status, requiresApproval ? 1 : 0, nowIso()],
  );
  state.append('pi_activity', { type: 'pi_action_recorded', board_id: boardId, action_id: Number(result.lastInsertRowid), action, pin, status, requires_approval: requiresApproval });
  return Number(result.lastInsertRowid);
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  const pin = sanitizePin(args.pin);
  const approved = args.approved === true;
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');

  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);

  const isPwm = args.duty_cycle !== undefined && args.duty_cycle !== null;
  let valueSummary;
  let dutyCycle = 0;
  let level = 0;

  if (isPwm) {
    dutyCycle = Number(args.duty_cycle);
    if (!Number.isFinite(dutyCycle) || dutyCycle < 0 || dutyCycle > 100) throw new Error('duty_cycle must be a number between 0 and 100');
    valueSummary = `pwm ${dutyCycle}%`;
  } else {
    level = args.level === true || args.level === 1 || args.level === '1' ? 1 : 0;
    valueSummary = `level=${level}`;
  }

  const action = isPwm ? 'pwm' : 'write';

  if (!approved) {
    const actionId = record(state, boardId, action, pin, `blocked: ${valueSummary}`, 'blocked', true);
    return {
      success: true,
      output: {
        board_id: boardId,
        pin,
        blocked: true,
        action_id: actionId,
        message: `GPIO write to pin ${pin} (${valueSummary}) requires explicit user approval. Ask the user, then call pi_gpio_write again with approved: true.`,
      },
    };
  }

  try {
    if (board.target_kind === 'virtual') {
      const sim = getSimPin(state, boardId, pin);
      if (sim?.fault === 'write_fails') {
        throw new Error(`simulated write failure on pin ${pin} (fault=write_fails, seeded via pi_sim_seed)`);
      }
      upsertSimPin(state, boardId, pin, isPwm ? { duty_cycle: dutyCycle } : { level });
    } else {
      const cliArgs = isPwm
        ? ['set', String(pin), 'op', String(dutyCycle)]
        : ['set', String(pin), level ? 'dh' : 'dl'];
      await runOnBoard(board, 'pinctrl', cliArgs, options);
    }
    const actionId = record(state, boardId, action, pin, valueSummary, 'completed', false);
    state.query('UPDATE pi_boards SET status = ?, updated_at = ? WHERE id = ?', ['connected', nowIso(), boardId]);
    return { success: true, output: { board_id: boardId, pin, blocked: false, action_id: actionId, executed: valueSummary } };
  } catch (err) {
    record(state, boardId, 'error', pin, err?.message || String(err), 'failed', false);
    throw err;
  }
}
