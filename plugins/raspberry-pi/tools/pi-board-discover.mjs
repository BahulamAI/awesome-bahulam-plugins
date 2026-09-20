import { nowIso, resolveState, runOnBoard, parsePinctrlOutput, parseI2cDetectOutput } from './lib.mjs';

function record(state, boardId, action, valueSummary, status) {
  const result = state.query(
    `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
     VALUES (?, ?, NULL, ?, ?, 0, ?)`,
    [boardId, action, valueSummary || '', status, nowIso()],
  );
  state.append('pi_activity', { type: 'pi_action_recorded', board_id: boardId, action_id: Number(result.lastInsertRowid), action, status });
  return Number(result.lastInsertRowid);
}

function discoverVirtual(state, board) {
  const pins = state.query('SELECT * FROM pi_sim_pins WHERE board_id = ? ORDER BY pin ASC', [board.id])
    .map(row => ({ pin: row.pin, func: row.duty_cycle !== null ? 'pwm' : 'sim', pull: '-', level: row.level ? 'hi' : 'lo', label: 'simulated' }));
  const registers = state.query('SELECT DISTINCT address FROM pi_sim_registers WHERE board_id = ? ORDER BY address ASC', [board.id]);
  return {
    model: `Virtual Raspberry Pi (simulated board "${board.name}")`,
    pins,
    i2cAddresses: registers.map(r => r.address),
  };
}

async function discoverReal(board, options) {
  const model = await runOnBoard(board, 'cat', ['/proc/device-tree/model'], options).catch(() => ({ stdout: 'unknown' }));
  const gpio = await runOnBoard(board, 'pinctrl', [], options).catch(() => ({ stdout: '' }));
  const i2c = await runOnBoard(board, 'i2cdetect', ['-y', '1'], options).catch(() => ({ stdout: '' }));
  return {
    model: model.stdout.trim().replace(/\0/g, ''),
    pins: parsePinctrlOutput(gpio.stdout),
    i2cAddresses: parseI2cDetectOutput(i2c.stdout),
  };
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');
  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);

  try {
    const discovered = board.target_kind === 'virtual'
      ? discoverVirtual(state, board)
      : await discoverReal(board, options);

    state.query('UPDATE pi_boards SET status = ?, updated_at = ? WHERE id = ?', ['connected', nowIso(), boardId]);
    const target = board.target_kind === 'ssh' ? `${board.user}@${board.host}:${board.port}` : board.target_kind === 'virtual' ? `virtual:${board.name}` : 'local';
    state.set('pi_runtime_state', { active_board_id: boardId, target, status: 'connected' });
    record(state, boardId, 'discover', `model=${discovered.model}; pins=${discovered.pins.length}; i2c=${discovered.i2cAddresses.length}`, 'completed');

    return {
      success: true,
      output: {
        board_id: boardId,
        target_kind: board.target_kind,
        model: discovered.model,
        pin_count: discovered.pins.length,
        pins: discovered.pins,
        i2c_addresses: discovered.i2cAddresses,
      },
    };
  } catch (err) {
    state.query('UPDATE pi_boards SET status = ?, updated_at = ? WHERE id = ?', ['blocked', nowIso(), boardId]);
    record(state, boardId, 'error', err?.message || String(err), 'failed');
    throw err;
  }
}
