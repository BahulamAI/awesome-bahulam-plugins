import { nowIso, resolveState, sanitizePin } from './lib.mjs';

const MODES = new Set(['in', 'out', 'pwm', 'i2c', 'spi']);

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  const pin = sanitizePin(args.pin);
  const mode = String(args.mode || '').trim();
  const role = String(args.role || '').trim();
  const isActuator = args.is_actuator === true;
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');
  if (!MODES.has(mode)) throw new Error(`mode must be one of: ${[...MODES].join(', ')}`);
  if (!role) throw new Error('role is required, e.g. "status LED" or "relay channel 1"');

  const board = state.query('SELECT id FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);

  const result = state.query(
    'INSERT INTO pi_pins (board_id, pin, mode, role, is_actuator, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [boardId, pin, mode, role, isActuator ? 1 : 0, nowIso()],
  );
  const pinRowId = Number(result.lastInsertRowid);
  state.append('pi_activity', { type: 'pin_configured', board_id: boardId, pin_row_id: pinRowId, pin, mode, role, is_actuator: isActuator });

  return { success: true, output: { pin_row_id: pinRowId, board_id: boardId, pin, mode, role, is_actuator: isActuator } };
}
