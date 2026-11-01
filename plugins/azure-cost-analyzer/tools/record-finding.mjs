/**
 * Record what an investigation concluded, separately from the raw figures it
 * read. `cost_runs`/`cost_rows` are evidence the Azure portal already shows
 * better than this panel can; a finding — what was concluded, and what is
 * proposed — has no equivalent there, which is why it is the thing this
 * plugin's panel exists to carry.
 *
 * Deliberately inert: this tool never performs the action it recommends.
 * `requires_approval` is itself just a recorded fact, not a gate — the
 * workspace's own remediation/executor flow decides whether and when a
 * proposed action actually runs.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
export async function call(args = {}, { state } = {}) {
  const conclusion = String(args.conclusion || '').trim();
  if (!conclusion) return { success: false, output: 'conclusion is required.' };

  if (!state || typeof state.query !== 'function') {
    return { success: false, output: 'plugin state is unavailable.' };
  }

  const severity = args.severity ? String(args.severity) : null;
  const recommendedAction = args.recommended_action ? String(args.recommended_action) : null;
  const requiresApproval = Boolean(args.requires_approval);
  const relatedRunId = Number.isFinite(Number(args.related_run_id)) ? Number(args.related_run_id) : null;
  const capturedAt = new Date().toISOString();

  try {
    state.query(
      `INSERT INTO findings
         (captured_at, related_run_id, conclusion, severity, recommended_action, requires_approval, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [capturedAt, relatedRunId, conclusion, severity, recommendedAction, requiresApproval ? 1 : 0],
    );
    const id = state.query('SELECT last_insert_rowid() AS id')?.[0]?.id;
    return { success: true, output: { finding_id: id, requires_approval: requiresApproval } };
  } catch (error) {
    return { success: false, output: error?.message ? String(error.message) : String(error) };
  }
}
