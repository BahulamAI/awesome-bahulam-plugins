import { nowIso, resolveState, summarizeField } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const sessionId = Number(args.session_id);
  const label = String(args.label || '').trim();
  const fields = Array.isArray(args.fields) ? args.fields.map(summarizeField).filter(f => f.name) : [];
  const redactions = Array.isArray(args.redactions) ? args.redactions.map(String) : [];
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('session_id must be a positive integer');
  if (!label) throw new Error('label is required');
  if (!fields.length) throw new Error('fields must contain at least one field');

  const result = state.query(
    `INSERT INTO form_profiles (session_id, label, fields_json, redactions_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, label, JSON.stringify(fields), JSON.stringify(redactions), nowIso()],
  );
  const profileId = Number(result.lastInsertRowid);
  state.append('browser_activity', {
    type: 'form_profile_created',
    session_id: sessionId,
    profile_id: profileId,
    label,
    fields: fields.map(f => ({ name: f.name, sensitive: f.sensitive, source: f.source })),
  });

  return {
    success: true,
    output: { profile_id: profileId, session_id: sessionId, label, field_count: fields.length, redactions },
  };
}
