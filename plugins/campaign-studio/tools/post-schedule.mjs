import { appendActivity, campaignById, nowIso, one, run, slugify, stateOf } from './lib.mjs';

function utmUrl(base, campaign, channel) {
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}utm_source=${encodeURIComponent(channel)}&utm_medium=social&utm_campaign=${encodeURIComponent(slugify(campaign.name))}`;
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const campaign = campaignById(state, args.campaign_id);
    const requested = Array.isArray(args.variant_ids) ? args.variant_ids.map(Number).filter(Number.isInteger) : [];
    const variants = requested.length
      ? requested.map(id => one(state, 'SELECT * FROM variants WHERE id = ? AND campaign_id = ?', [id, campaign.id])).filter(Boolean)
      : state.query('SELECT * FROM variants WHERE campaign_id = ?', [campaign.id]);
    if (!variants.length) return { success: false, output: 'No variants found to schedule.' };
    const scheduledAt = String(args.scheduled_at || '').trim() || nowIso();
    const landingUrl = String(args.landing_url || '').trim();
    const ts = nowIso();
    const posts = [];
    for (const variant of variants) {
      const url = `simulated://${variant.channel}/${campaign.id}/${variant.id}`;
      const info = run(state, 'INSERT INTO posts (campaign_id, variant_id, channel, status, scheduled_at, published_at, url, utm_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        campaign.id,
        variant.id,
        variant.channel,
        'scheduled',
        scheduledAt,
        null,
        url,
        utmUrl(landingUrl, campaign, variant.channel),
        ts,
      ]);
      posts.push({ id: Number(info.lastInsertRowid || 0), campaign_id: campaign.id, variant_id: variant.id, channel: variant.channel, status: 'scheduled', scheduled_at: scheduledAt, url });
    }
    run(state, 'UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', ['scheduled', ts, campaign.id]);
    state.patch?.('campaign_state', { active_campaign_id: campaign.id, active_campaign: campaign.name, status: 'scheduled' });
    appendActivity(state, 'posts_scheduled', { campaign_id: campaign.id, count: posts.length, scheduled_at: scheduledAt });
    return { success: true, output: { campaign_id: campaign.id, mode: 'simulated', posts } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
