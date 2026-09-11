import { appendActivity, campaignById, nowIso, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const campaign = campaignById(state, args.campaign_id);
    const reviewer = String(args.reviewer || '').trim();
    const decision = String(args.decision || '').trim();
    const allowed = new Set(['approved', 'rejected', 'changes_requested']);
    if (!reviewer || !allowed.has(decision)) {
      return { success: false, output: 'reviewer and decision approved|rejected|changes_requested are required.' };
    }
    const variantId = args.variant_id == null ? null : Number(args.variant_id);
    const notes = String(args.notes || '').trim();
    const ts = nowIso();
    const info = run(state, 'INSERT INTO approvals (campaign_id, variant_id, reviewer, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      campaign.id,
      Number.isInteger(variantId) && variantId > 0 ? variantId : null,
      reviewer,
      decision,
      notes,
      ts,
    ]);
    if (variantId) {
      run(state, 'UPDATE variants SET status = ?, updated_at = ? WHERE id = ? AND campaign_id = ?', [decision, ts, variantId, campaign.id]);
    }
    appendActivity(state, 'approval_recorded', { campaign_id: campaign.id, variant_id: variantId, reviewer, decision });
    return { success: true, output: { approval_id: Number(info.lastInsertRowid || 0), campaign_id: campaign.id, variant_id: variantId, reviewer, decision, notes } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
