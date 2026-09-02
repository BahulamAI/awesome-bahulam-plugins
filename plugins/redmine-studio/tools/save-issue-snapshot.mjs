/**
 * save_issue_snapshot — persist one Redmine issue to the studio's
 * blackboard. Keyed by issue id so re-saving the same issue updates
 * (kv semantics, not append). The workspace panel binds to this stream
 * and re-renders on every write.
 */
export async function call(args = {}, options = {}) {
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1) {
    return { success: false, output: 'id must be a positive integer' };
  }
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable' };

  const snapshot = {
    id,
    subject: String(args.subject || ''),
    status: String(args.status || ''),
    priority: String(args.priority || ''),
    assignee: String(args.assignee || ''),
    project: String(args.project || ''),
    notes: String(args.notes || '').slice(0, 500),
    at: new Date().toISOString(),
  };
  state.set(`issue:${id}`, snapshot);

  return {
    success: true,
    output: `Snapshotted #${id}: ${snapshot.subject || '(no subject)'}`,
    snapshot,
  };
}
