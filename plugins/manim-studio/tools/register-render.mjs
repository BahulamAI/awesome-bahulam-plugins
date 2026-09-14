/**
 * register_render — record a render outcome on the shared blackboard.
 * The workspace gallery lists from this stream and re-renders live on
 * the plugin_state_changed pulse (including the coarse cross-process
 * one when the reviewer ran in the terminal).
 */
import { appendEvent, appendStream, nowIso, rows, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const name = String(args.name || '').trim();
  const status = String(args.status || '').trim();
  if (!name || !status) {
    return { success: false, output: 'name and status are required.' };
  }
  const state = await stateOf(options);
  if (!state) {
    return { success: false, output: 'Shared blackboard unavailable in this context.' };
  }
  const allowed = new Set(['completed', 'failed', 'fixed_and_rerendered']);
  if (!allowed.has(status)) {
    return { success: false, output: 'status must be completed, failed, or fixed_and_rerendered.' };
  }
  const ts = nowIso();
  const payload = {
    name,
    scene_class: String(args.scene_class || ''),
    status,
    video_path: String(args.video_path || ''),
    duration_s: Number(args.duration_s) || null,
    notes: String(args.notes || '').slice(0, 500),
    recorded_at: ts,
  };
  appendStream(state, 'renders', payload);
  const scene = rows(state, 'SELECT id FROM render_scenes WHERE slug = ? ORDER BY id DESC LIMIT 1', [name])[0] || null;
  run(state, `INSERT INTO render_jobs
    (scene_id, slug, status, video_path, duration_s, notes, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    scene ? scene.id : null,
    name,
    status,
    payload.video_path,
    payload.duration_s,
    payload.notes,
    ts,
    ts,
  ]);
  run(state, 'UPDATE render_scenes SET status = ?, updated_at = ? WHERE slug = ?', [status, ts, name]);
  appendEvent(state, 'render_registered', { slug: name, status, video_path: payload.video_path });
  return { success: true, output: `Render recorded: ${name} → ${status}` };
}
