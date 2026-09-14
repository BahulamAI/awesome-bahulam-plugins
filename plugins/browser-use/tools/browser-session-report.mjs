import { parseJson, resolveState } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const sessionId = Number(args.session_id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('session_id must be a positive integer');

  const sessions = state.query('SELECT * FROM browser_sessions WHERE id = ? LIMIT 1', [sessionId]);
  const session = sessions[0];
  if (!session) throw new Error(`session ${sessionId} not found`);
  const profiles = state.query('SELECT * FROM form_profiles WHERE session_id = ? ORDER BY id DESC', [sessionId]);
  const actions = state.query('SELECT * FROM browser_actions WHERE session_id = ? ORDER BY id ASC', [sessionId]);
  const approvalGates = actions.filter(row => Number(row.requires_approval) === 1 && row.status !== 'approved');
  const latestProfileFields = profiles[0] ? parseJson(profiles[0].fields_json, []) : [];
  const filledActions = actions.filter(row => ['type', 'select'].includes(row.action) && row.status === 'completed');
  const skippedActions = actions.filter(row => ['blocked', 'failed'].includes(row.status));
  const screenshot = [...actions].reverse().find(row => row.action === 'screenshot' && row.status === 'completed');
  const storageCheck = [...actions].reverse().find(row => row.action === 'extract' && row.selector === 'localStorage');
  const submitGate = [...actions].reverse().find(row => row.action === 'submit');
  const handoffStatus = session.status === 'completed'
    ? 'submitted_with_approval'
    : (submitGate && submitGate.status === 'blocked' ? 'filled_waiting_for_user_submit' : session.status);

  const markdown = [
    'BROWSER_USE_HANDOFF',
    '',
    `Status: ${handoffStatus}`,
    `Browser: ${handoffStatus === 'filled_waiting_for_user_submit' ? 'left open for user review when executed with default handoff' : 'see action trail'}`,
    `Current URL: ${session.url}`,
    `Session id: ${session.id}`,
    `Profiles: ${profiles.length}`,
    `Actions recorded: ${actions.length}`,
    `Filled field actions: ${filledActions.length}`,
    `Skipped/blocked actions: ${skippedActions.length}`,
    `Screenshot path: ${screenshot?.value_summary || 'not recorded'}`,
    `localStorage/output verification: ${storageCheck ? `${storageCheck.status} (${storageCheck.value_summary})` : 'not requested'}`,
    `Submit state: ${submitGate ? `${submitGate.status}; ${submitGate.value_summary}` : 'not submitted; no submit action recorded'}`,
    'Required next step: ask the user to review the open browser and click Submit manually if correct.',
    '',
    `# Browser Use Session: ${session.name}`,
    '',
    `- URL: ${session.url}`,
    `- Purpose: ${session.purpose}`,
    `- Status: ${session.status}`,
    `- Profiles: ${profiles.length}`,
    `- Actions: ${actions.length}`,
    `- Pending approval gates: ${approvalGates.length}`,
    '',
    '## Handoff Evidence',
    `- The browser-use agent must not claim success without browser_session_create plus browser_form_fill evidence.`,
    `- If status is filled_waiting_for_user_submit, the main/platform agent owns the final user-facing prompt.`,
    `- The user-facing prompt should say: "The form is filled and waiting in the browser. Please review the values, then click Submit manually if everything looks correct."`,
    '',
    '## Latest Profile',
    latestProfileFields.length
      ? latestProfileFields.map(field => `- ${field.name}${field.selector ? ` (${field.selector})` : ''}: ${field.sensitive ? 'redacted' : field.value_summary || 'planned'}; source=${field.source || 'user'}`).join('\n')
      : '- No profile recorded yet.',
    '',
    '## Action Trail',
    actions.length
      ? actions.map(row => `- ${row.action} ${row.selector || ''} — ${row.status}${row.requires_approval ? ' (approval required)' : ''}`).join('\n')
      : '- No actions recorded yet.',
  ].join('\n');

  return {
    success: true,
    output: { session, profiles, actions, approval_gates: approvalGates, markdown },
  };
}
