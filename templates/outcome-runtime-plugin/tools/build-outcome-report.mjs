import { one, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const workItemId = Number(args.work_item_id);
    if (!Number.isInteger(workItemId) || workItemId <= 0) {
      return { success: false, output: 'work_item_id must be a positive integer.' };
    }
    const item = one(state, 'SELECT * FROM work_items WHERE id = ?', [workItemId]);
    if (!item) return { success: false, output: `Work item not found: ${workItemId}` };
    const outcomes = state.query('SELECT * FROM outcomes WHERE work_item_id = ? ORDER BY id', [workItemId]);
    const lines = [
      `# ${item.title}`,
      '',
      `Status: ${item.status}`,
      `Objective: ${item.objective}`,
      '',
      '## Outcomes',
      outcomes.length ? outcomes.map(o => `- ${o.kind}: ${o.summary}${o.artifact_path ? ` (${o.artifact_path})` : ''}`).join('\n') : '- No outcomes recorded.',
    ];
    return {
      success: true,
      output: {
        work_item_id: workItemId,
        title: item.title,
        status: item.status,
        outcome_count: outcomes.length,
        markdown: lines.join('\n'),
      },
    };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
