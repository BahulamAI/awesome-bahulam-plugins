import { resolveState, sanitizePin, upsertSimPin, upsertSimRegister } from './lib.mjs';

const PIN_FAULTS = new Set(['', 'write_fails', 'read_fails']);
const REGISTER_FAULTS = new Set(['', 'read_fails']);

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');

  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);
  if (board.target_kind !== 'virtual') throw new Error('pi_sim_seed only applies to target_kind=virtual boards');

  const pins = Array.isArray(args.pins) ? args.pins : [];
  const registers = Array.isArray(args.registers) ? args.registers : [];

  const seededPins = pins.map(p => {
    const pin = sanitizePin(p.pin);
    const fault = String(p.fault || '');
    if (!PIN_FAULTS.has(fault)) throw new Error(`pin fault must be one of: ${[...PIN_FAULTS].filter(Boolean).join(', ')}`);
    const fields = { fault };
    if (p.level !== undefined) fields.level = p.level ? 1 : 0;
    if (p.duty_cycle !== undefined) fields.duty_cycle = Number(p.duty_cycle);
    return upsertSimPin(state, boardId, pin, fields);
  });

  const seededRegisters = registers.map(r => {
    const address = String(r.address || '').trim().toLowerCase();
    const register = String(r.register || '').trim().toLowerCase();
    const fault = String(r.fault || '');
    if (!/^0x[0-9a-f]{2}$/.test(address)) throw new Error('address must be a hex string like "0x48"');
    if (!/^0x[0-9a-f]{2}$/.test(register)) throw new Error('register must be a hex string like "0x00"');
    if (!REGISTER_FAULTS.has(fault)) throw new Error(`register fault must be one of: ${[...REGISTER_FAULTS].filter(Boolean).join(', ')}`);
    return upsertSimRegister(state, boardId, address, register, { value: r.value !== undefined ? String(r.value) : undefined, fault });
  });

  state.append('pi_activity', { type: 'sim_seeded', board_id: boardId, pin_count: seededPins.length, register_count: seededRegisters.length });

  return {
    success: true,
    output: { board_id: boardId, pins: seededPins, registers: seededRegisters },
  };
}
