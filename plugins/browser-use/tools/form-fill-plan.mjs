import { nowIso, parseJson, resolveState } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const sessionId = Number(args.session_id);
  const profileId = Number(args.profile_id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('session_id must be a positive integer');
  if (!Number.isInteger(profileId) || profileId <= 0) throw new Error('profile_id must be a positive integer');

  const rows = state.query(
    'SELECT id, fields_json FROM form_profiles WHERE id = ? AND session_id = ? LIMIT 1',
    [profileId, sessionId],
  );
  const profile = rows[0];
  if (!profile) throw new Error(`profile ${profileId} not found for session ${sessionId}`);
  const fields = parseJson(profile.fields_json, []);
  const steps = [
    { action: 'open', selector: '', value_summary: 'open selected URL', requires_approval: false },
    ...fields.map(field => ({
      action: field.selector ? 'type' : 'extract',
      selector: field.selector || '',
      value_summary: field.sensitive ? `${field.name}: redacted` : `${field.name}: ${field.value_summary || 'needs value'}`,
      requires_approval: false,
    })),
  ];
  if (args.include_submit) {
    steps.push({ action: 'submit', selector: 'form submit control', value_summary: 'final submit requires approval', requires_approval: true });
  }

  for (const step of steps) {
    state.query(
      `INSERT INTO browser_actions (session_id, action, selector, value_summary, status, requires_approval, created_at)
       VALUES (?, ?, ?, ?, 'planned', ?, ?)`,
      [sessionId, step.action, step.selector, step.value_summary, step.requires_approval ? 1 : 0, nowIso()],
    );
  }
  state.append('browser_activity', { type: 'fill_plan_created', session_id: sessionId, profile_id: profileId, step_count: steps.length });

  return { success: true, output: { session_id: sessionId, profile_id: profileId, steps } };
}
