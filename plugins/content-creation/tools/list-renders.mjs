/**
 * list_renders — saved scenes + render outcomes from the blackboard,
 * newest first. Read side of the studio's history.
 */
export async function call(args = {}, options = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'Shared blackboard unavailable in this context.' };
  }
  const renders = state.list('renders', { limit, order: 'desc' }) || [];
  const scenes = state.list('scenes', { limit, order: 'desc' }) || [];
  if (!renders.length && !scenes.length) {
    return { success: true, output: 'No scenes or renders yet.', renders: [], scenes: [] };
  }
  const lines = renders.map(r => {
    const p = r.payload || {};
    return `${p.status === 'completed' ? '✓' : p.status === 'failed' ? '✗' : '↻'} ${p.name} (${p.scene_class || '?'})`
      + (p.duration_s ? ` · ${p.duration_s}s` : '')
      + (p.video_path ? ` · ${p.video_path}` : '')
      + (p.notes ? ` — ${p.notes}` : '');
  });
  return {
    success: true,
    output: lines.join('\n') || '(scenes saved, no renders recorded yet)',
    renders: renders.map(r => r.payload),
    scenes: scenes.map(s => s.payload),
  };
}
