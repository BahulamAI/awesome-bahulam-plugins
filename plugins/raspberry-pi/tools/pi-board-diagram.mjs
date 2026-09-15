import { resolveState } from './lib.mjs';

const MODE_ORDER = ['in', 'out', 'pwm', 'i2c', 'spi'];

function escapeLabel(value) {
  return String(value ?? '').replace(/"/g, '#quot;').replace(/\n/g, ' ');
}

function targetLabel(board) {
  if (board.target_kind === 'ssh') return `${board.user}@${board.host}:${board.port}`;
  if (board.target_kind === 'virtual') return `virtual:${board.name}`;
  return 'local';
}

/**
 * Renders a board's declared pins as a Mermaid flowchart: one subgraph per
 * mode (in/out/pwm/i2c/spi), pin nodes labeled with role, actuator pins
 * styled distinctly so real-world-effect pins stand out at a glance.
 */
export function buildMermaid(board, pins) {
  const lines = ['flowchart LR'];
  lines.push(`  BOARD["\u{1F5A5} ${escapeLabel(board.name)}<br/>${escapeLabel(targetLabel(board))} (${escapeLabel(board.target_kind)})<br/>status: ${escapeLabel(board.status)}"]`);

  const byMode = new Map(MODE_ORDER.map(mode => [mode, pins.filter(p => p.mode === mode)]));
  let declared = 0;

  for (const mode of MODE_ORDER) {
    const modePins = byMode.get(mode);
    if (!modePins.length) continue;
    const subId = `MODE_${mode.toUpperCase()}`;
    lines.push(`  subgraph ${subId}["${mode} pins"]`);
    for (const p of modePins) {
      declared += 1;
      const nodeId = `PIN_${p.pin}_${p.id}`;
      lines.push(`    ${nodeId}["GPIO${p.pin}<br/>${escapeLabel(p.role || mode)}"]`);
      lines.push(`    class ${nodeId} ${p.is_actuator ? 'actuator' : 'pin'}`);
    }
    lines.push('  end');
    lines.push(`  BOARD --> ${subId}`);
  }

  if (!declared) {
    lines.push('  NONE["no pins declared yet"]');
    lines.push('  BOARD --> NONE');
  }

  lines.push('  classDef board fill:#171b22,stroke:#a5adba,color:#eff3f8,stroke-width:1px');
  lines.push('  classDef pin fill:#12313a,stroke:#39c6d6,color:#eff3f8,stroke-width:1px');
  lines.push('  classDef actuator fill:#3a2412,stroke:#f0b429,color:#ffe9b3,stroke-width:2px');
  lines.push('  class BOARD board');

  return { mermaid: lines.join('\n'), declared_pin_count: declared };
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const boardId = Number(args.board_id);
  if (!Number.isInteger(boardId) || boardId <= 0) throw new Error('board_id must be a positive integer');

  const board = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [boardId])[0];
  if (!board) throw new Error(`board ${boardId} not found`);
  const pins = state.query('SELECT * FROM pi_pins WHERE board_id = ? ORDER BY pin ASC', [boardId]);

  const { mermaid, declared_pin_count } = buildMermaid(board, pins);
  const actuatorCount = pins.filter(p => p.is_actuator).length;

  return {
    success: true,
    output: {
      board_id: boardId,
      format: 'mermaid',
      pin_count: declared_pin_count,
      actuator_count: actuatorCount,
      mermaid,
      markdown: `\`\`\`mermaid\n${mermaid}\n\`\`\``,
    },
  };
}
