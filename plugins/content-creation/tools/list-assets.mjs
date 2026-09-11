export async function call(args = {}, options = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable in this context.' };
  const assets = state.list('assets', { limit, order: 'desc' }) || [];
  const briefs = state.list('briefs', { limit, order: 'desc' }) || [];
  const lines = assets.map(row => {
    const p = row.payload || {};
    return `${p.kind || 'asset'} ${p.name || ''} · ${p.status || ''}${p.path ? ` · ${p.path}` : ''}`;
  });
  return {
    success: true,
    output: lines.join('\n') || 'No content assets yet.',
    assets: assets.map(row => ({ id: row.id, ...(row.payload || {}), created_at: row.created_at })),
    briefs: briefs.map(row => ({ id: row.id, ...(row.payload || {}), created_at: row.created_at })),
  };
}
