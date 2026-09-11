import { appendActivity, nowIso, one, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const postId = Number(args.post_id);
    if (!Number.isInteger(postId) || postId <= 0) return { success: false, output: 'post_id must be a positive integer.' };
    const post = one(state, 'SELECT * FROM posts WHERE id = ?', [postId]);
    if (!post) return { success: false, output: `Post not found: ${postId}` };
    const impressions = Math.max(0, Number(args.impressions) || 0);
    const clicks = Math.max(0, Number(args.clicks) || 0);
    const conversions = Math.max(0, Number(args.conversions) || 0);
    const spend = Math.max(0, Number(args.spend) || 0);
    const ts = nowIso();
    const info = run(state, 'INSERT INTO metrics (post_id, impressions, clicks, conversions, spend, captured_at) VALUES (?, ?, ?, ?, ?, ?)', [
      postId,
      impressions,
      clicks,
      conversions,
      spend,
      ts,
    ]);
    appendActivity(state, 'metrics_recorded', { campaign_id: post.campaign_id, post_id: postId, impressions, clicks, conversions, spend });
    return { success: true, output: { metric_id: Number(info.lastInsertRowid || 0), post_id: postId, impressions, clicks, conversions, spend, captured_at: ts } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
