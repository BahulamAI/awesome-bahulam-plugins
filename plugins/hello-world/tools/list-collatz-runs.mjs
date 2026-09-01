/**
 * list_collatz_runs — read history from the Shared Blackboard.
 *
 * Reference tool for the READ side of the SQLite state layer. Shows how
 * a plugin exposes semantic access to its own persisted data so the
 * agent can reason over history without touching SQL directly.
 *
 * The `collatz_runs` stream is populated by tools/collatz.mjs on every
 * run; anything either the agent OR the human clicking in the workspace
 * view has done shows up here — that's the shared-blackboard promise.
 */

export const name = 'list_collatz_runs';
export const description
  = 'List past Collatz runs from the plugin\'s persisted history. '
  + 'Newest first by default; use order:"asc" for chronological.';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    // Handler called without a state handle (e.g. bare unit test). Not
    // an error — just return an empty history so tests can assert shape.
    return { success: true, output: { runs: [], count: 0, note: 'no state handle available' } };
  }

  const limit = Math.max(1, Math.min(500, Number(args.limit) || 20));
  const order = args.order === 'asc' ? 'asc' : 'desc';

  try {
    const rows = state.list('collatz_runs', { limit, order });
    return {
      success: true,
      output: {
        count: rows.length,
        runs: rows.map(r => ({
          id: r.id,
          created_at: r.created_at,
          ...r.payload,
        })),
      },
    };
  } catch (err) {
    return { success: false, output: `list_collatz_runs: ${err.message}` };
  }
}
