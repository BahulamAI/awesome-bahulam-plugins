/**
 * list_snapshots — return persisted issue snapshots from the blackboard,
 * newest first. Cheap; the agent should prefer this over re-querying
 * Redmine when the user asks about tickets already discussed.
 */
export async function call(args = {}, options = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 500);
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable' };

  const keys = state.keys().filter(k => k.startsWith('issue:'));
  const snapshots = keys
    .map(k => state.get(k))
    .filter(Boolean)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, limit);

  if (!snapshots.length) return { success: true, output: 'No snapshots yet.', snapshots: [] };

  const lines = snapshots.map(s =>
    `#${s.id} · ${s.subject}${s.status ? ` [${s.status}]` : ''}` +
    (s.priority ? ` (${s.priority})` : '') +
    (s.assignee ? ` — @${s.assignee}` : '') +
    (s.notes ? ` — ${s.notes}` : '')
  );
  return { success: true, output: lines.join('\n'), snapshots };
}
