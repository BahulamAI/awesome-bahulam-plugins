export async function call(args = {}, options = {}) {
  const name = String(args.name || '').trim();
  const kind = String(args.kind || '').trim();
  const status = String(args.status || '').trim();
  if (!name || !kind || !status) return { success: false, output: 'name, kind, and status are required.' };
  const asset = {
    name,
    kind,
    path: String(args.path || '').trim(),
    prompt: String(args.prompt || '').slice(0, 2000),
    status,
    notes: String(args.notes || '').slice(0, 1000),
    created_at: new Date().toISOString(),
  };
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'Shared blackboard unavailable in this context.' };
  const id = state.append('assets', asset);
  return { success: true, output: `Recorded ${kind} asset: ${name}`, asset: { id, ...asset } };
}
