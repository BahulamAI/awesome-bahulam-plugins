import { resolveState } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');

  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);
  const pins = state.query('SELECT * FROM pi_pins WHERE board_id = ? ORDER BY id ASC', [boardId]);
  const actions = state.query('SELECT * FROM pi_actions WHERE board_id = ? ORDER BY id ASC', [boardId]);
  const approvalGates = actions.filter(row => Number(row.requires_approval) === 1);
  const writesExecuted = actions.filter(row => ['write', 'pwm'].includes(row.action) && row.status === 'completed');
  const blockedActions = actions.filter(row => ['blocked', 'failed'].includes(row.status));

  const target = board.target_kind === 'ssh'
    ? `${board.user}@${board.host}:${board.port}`
    : board.target_kind === 'virtual'
      ? `virtual:${board.name}`
      : 'local';

  const markdown = [
    'PI_HANDOFF',
    '',
    `Status: ${board.status}`,
    `Target: ${target} (${board.target_kind})`,
    `Board id: ${board.id}`,
    `Pins declared: ${pins.length}`,
    `Actions recorded: ${actions.length}`,
    `Writes executed: ${writesExecuted.length}`,
    `Blocked/failed actions: ${blockedActions.length}`,
    `Pending approval gates: ${approvalGates.length}`,
    'Required next step: ask the user for explicit approval before calling pi_gpio_write with approved: true on any pending gate.',
    '',
    `# Raspberry Pi Board: ${board.name}`,
    '',
    `- Target: ${target}`,
    `- Target kind: ${board.target_kind}`,
    `- Status: ${board.status}`,
    `- Pins: ${pins.length}`,
    `- Actions: ${actions.length}`,
    `- Pending approval gates: ${approvalGates.length}`,
    '',
    '## Handoff Evidence',
    '- The raspberry-pi agent must not claim a GPIO write succeeded without a pi_gpio_write action recorded with approved: true and status completed.',
    '- Every GPIO write requires explicit user approval before it executes, on every target_kind including virtual — a blocked action here means the user has not yet approved it.',
    '- Credentials are never echoed: only the auth_env variable name is reported, never its resolved value.',
    '',
    '## Pin Map',
    pins.length
      ? pins.map(p => `- GPIO${p.pin} (${p.mode}) — ${p.role}${p.is_actuator ? ' [actuator: real-world effect]' : ''}`).join('\n')
      : '- No pins declared yet.',
    '',
    '## Action Trail',
    actions.length
      ? actions.map(row => `- ${row.action}${row.pin !== null && row.pin !== undefined ? ` pin=${row.pin}` : ''} — ${row.status}${row.requires_approval ? ' (approval required)' : ''}: ${row.value_summary || ''}`).join('\n')
      : '- No actions recorded yet.',
  ].join('\n');

  return { success: true, output: { board, pins, actions, approval_gates: approvalGates, markdown } };
}
