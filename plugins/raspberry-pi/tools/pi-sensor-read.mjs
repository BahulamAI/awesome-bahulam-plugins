import { nowIso, resolveState, runOnBoard, getSimRegister } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  const bus = Number(args.bus ?? 1);
  const address = String(args.address || '').trim().toLowerCase();
  const register = String(args.register || '').trim().toLowerCase();
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');
  if (!/^0x[0-9a-f]{2}$/.test(address)) throw new Error('address must be a hex string like "0x48"');
  if (!/^0x[0-9a-f]{2}$/.test(register)) throw new Error('register must be a hex string like "0x00"');

  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);

  let raw;

  if (board.target_kind === 'virtual') {
    const sim = getSimRegister(state, boardId, address, register);
    if (sim?.fault === 'read_fails') {
      const failId = state.query(
        `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
         VALUES (?, 'sensor_read', NULL, ?, 'failed', 0, ?)`,
        [boardId, `simulated sensor read failure ${address}@${register}`, nowIso()],
      );
      state.append('pi_activity', { type: 'pi_action_recorded', board_id: boardId, action_id: Number(failId.lastInsertRowid), action: 'sensor_read', status: 'failed' });
      throw new Error(`simulated sensor read failure at ${address}@${register} (fault=read_fails, seeded via pi_sim_seed)`);
    }
    raw = sim ? sim.value : '00';
  } else {
    const result = await runOnBoard(board, 'i2cget', ['-y', String(bus), address, register], options);
    raw = result.stdout.trim();
  }

  const inserted = state.query(
    `INSERT INTO pi_actions (board_id, action, pin, value_summary, status, requires_approval, created_at)
     VALUES (?, 'sensor_read', NULL, ?, 'completed', 0, ?)`,
    [boardId, `${address}@${register}=${raw}`, nowIso()],
  );
  state.append('pi_activity', { type: 'pi_action_recorded', board_id: boardId, action_id: Number(inserted.lastInsertRowid), action: 'sensor_read', status: 'completed' });

  return { success: true, output: { board_id: boardId, bus, address, register, raw } };
}
