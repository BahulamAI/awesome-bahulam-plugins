/**
 * list_palettes — read the plugin's Shared Blackboard.
 *
 * Same shape as the hello-world reference — a semantic reader tool that
 * lets the agent reason over history without ever touching SQL.
 */

export const name = 'list_palettes';
export const description = 'List every palette previously saved to the shared blackboard';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: true, output: { palettes: [], count: 0, note: 'no state handle available' } };
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 50));
  const rows = state.list('palettes', { limit, order: 'desc' });
  return {
    success: true,
    output: {
      count: rows.length,
      palettes: rows.map(r => ({ id: r.id, created_at: r.created_at, ...r.payload })),
    },
  };
}
