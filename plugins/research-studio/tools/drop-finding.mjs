/**
 * drop_finding — remove a persisted finding by id.
 * Mirror op of the panel's "drop" button.
 */
export async function call(args = {}, options = {}) {
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1) {
    return { success: false, output: 'id must be a positive integer (from list_findings)' };
  }
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable' };

  // records use auto-increment ids; support raw SQL for deletion.
  const before = (state.list('findings', { limit: 500 }) || []).some(r => r.id === id);
  state.query('DELETE FROM records WHERE stream = ? AND id = ?', ['findings', id]);
  return {
    success: true,
    output: before ? `Dropped finding #${id}` : `No finding #${id} to drop`,
    dropped: before,
  };
}
