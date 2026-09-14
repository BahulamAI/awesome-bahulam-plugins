import { campaignById, rows, stateOf } from './lib.mjs';

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(2));
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const campaign = campaignById(state, args.campaign_id);
    const variants = rows(state, 'SELECT * FROM variants WHERE campaign_id = ? ORDER BY id', [campaign.id]);
    const posts = rows(state, 'SELECT * FROM posts WHERE campaign_id = ? ORDER BY id', [campaign.id]);
    const metrics = rows(state, `
      SELECT p.channel, p.variant_id, m.impressions, m.clicks, m.conversions, m.spend
      FROM posts p
      JOIN metrics m ON m.post_id = p.id
      WHERE p.campaign_id = ?
    `, [campaign.id]);
    const totals = metrics.reduce((acc, row) => {
      acc.impressions += Number(row.impressions) || 0;
      acc.clicks += Number(row.clicks) || 0;
      acc.conversions += Number(row.conversions) || 0;
      acc.spend += Number(row.spend) || 0;
      return acc;
    }, { impressions: 0, clicks: 0, conversions: 0, spend: 0 });
    const byChannel = {};
    for (const row of metrics) {
      const key = row.channel;
      byChannel[key] ||= { channel: key, impressions: 0, clicks: 0, conversions: 0, spend: 0 };
      byChannel[key].impressions += Number(row.impressions) || 0;
      byChannel[key].clicks += Number(row.clicks) || 0;
      byChannel[key].conversions += Number(row.conversions) || 0;
      byChannel[key].spend += Number(row.spend) || 0;
    }
    const channels = Object.values(byChannel).map(row => ({
      ...row,
      ctr_pct: pct(row.clicks, row.impressions),
      conversion_rate_pct: pct(row.conversions, row.clicks),
      cpa: row.conversions ? Number((row.spend / row.conversions).toFixed(2)) : null,
    }));
    const best = channels.slice().sort((a, b) => (b.conversions - a.conversions) || (b.ctr_pct - a.ctr_pct))[0] || null;
    const report = {
      campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective, audience: campaign.audience, offer: campaign.offer, status: campaign.status },
      inventory: { variants: variants.length, posts: posts.length, metric_rows: metrics.length },
      totals: {
        ...totals,
        ctr_pct: pct(totals.clicks, totals.impressions),
        conversion_rate_pct: pct(totals.conversions, totals.clicks),
        cpa: totals.conversions ? Number((totals.spend / totals.conversions).toFixed(2)) : null,
      },
      channels,
      recommendation: best
        ? `Double down on ${best.channel}; it currently leads on conversions or click-through. Create one sharper variant and rerun.`
        : 'No metrics recorded yet. Publish or record post metrics before deciding the next iteration.',
    };
    return { success: true, output: report };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
