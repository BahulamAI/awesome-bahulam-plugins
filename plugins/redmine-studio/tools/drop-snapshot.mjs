/**
 * drop_snapshot — remove an issue snapshot from the blackboard.
 * Mirror op of the panel's "clear" button.
 */
export async function call(args = {}, options = {}) {
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1) {
    return { success: false, output: 'id must be a positive integer' };
  }
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable' };

  const key = `issue:${id}`;
  const existed = state.get(key) != null;
  state.delete(key);
  return {
    success: true,
    output: existed ? `Dropped snapshot #${id}` : `No snapshot #${id} to drop`,
    dropped: existed,
  };
}
