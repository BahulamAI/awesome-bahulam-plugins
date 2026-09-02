/**
 * register_render — record a render outcome on the shared blackboard.
 * The workspace gallery lists from this stream and re-renders live on
 * the plugin_state_changed pulse (including the coarse cross-process
 * one when the reviewer ran in the terminal).
 */
export async function call(args = {}, options = {}) {
  const name = String(args.name || '').trim();
  const status = String(args.status || '').trim();
  if (!name || !status) {
    return { success: false, output: 'name and status are required.' };
  }
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'Shared blackboard unavailable in this context.' };
  }
  state.append('renders', {
    name,
    scene_class: String(args.scene_class || ''),
    status,
    video_path: String(args.video_path || ''),
    duration_s: Number(args.duration_s) || null,
    notes: String(args.notes || '').slice(0, 500),
  });
  return { success: true, output: `Render recorded: ${name} → ${status}` };
}
