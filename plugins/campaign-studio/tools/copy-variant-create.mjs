import { appendActivity, campaignById, normalizeChannels, nowIso, run, stateOf } from './lib.mjs';

function variantFor(campaign, channel, tone) {
  const toneLine = tone ? `${tone} ` : '';
  const map = {
    x: {
      headline: `${campaign.offer} for ${campaign.audience}`,
      body: `${campaign.objective}. Built for ${campaign.audience}: ${campaign.offer}.`,
      call_to_action: 'See the launch',
      asset_brief: `A sharp social card for X showing ${campaign.offer} with a clear product signal.`,
    },
    linkedin: {
      headline: `${campaign.name}: ${campaign.offer}`,
      body: `${toneLine}${campaign.objective}\n\nFor ${campaign.audience}, the offer is simple: ${campaign.offer}.\n\nWhat changes this week: clearer outcomes, less manual coordination, and a measurable next step.`,
      call_to_action: 'Read the campaign brief',
      asset_brief: `Professional LinkedIn visual with the campaign outcome, audience, and one metric placeholder.`,
    },
    instagram: {
      headline: campaign.offer,
      body: `${campaign.offer}\n\nMade for ${campaign.audience}.`,
      call_to_action: 'Tap to learn more',
      asset_brief: `Square visual with strong product screenshot area and concise overlay text.`,
    },
    email: {
      headline: `${campaign.offer}: a practical update for ${campaign.audience}`,
      body: `Hi,\n\n${campaign.objective}\n\nThe offer: ${campaign.offer}.\n\nThis is for ${campaign.audience}, with a clear path from interest to action.`,
      call_to_action: 'Open the offer',
      asset_brief: `Header image that reinforces the offer without crowding the email body.`,
    },
    blog: {
      headline: `${campaign.name}: ${campaign.objective}`,
      body: `This article explains why ${campaign.audience} should care about ${campaign.offer}, what problem it solves, and how to evaluate the outcome.`,
      call_to_action: 'Continue reading',
      asset_brief: `Editorial hero image grounded in the product workflow, not abstract gradients.`,
    },
  };
  return map[channel] || map.x;
}

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const campaign = campaignById(state, args.campaign_id);
    const channels = normalizeChannels(args.channels && args.channels.length ? args.channels : campaign.channels);
    const tone = String(args.tone || '').trim();
    const ts = nowIso();
    const created = [];
    for (const channel of channels) {
      const v = variantFor(campaign, channel, tone);
      const info = run(state, 'INSERT INTO variants (campaign_id, channel, headline, body, call_to_action, asset_brief, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        campaign.id,
        channel,
        v.headline,
        v.body,
        v.call_to_action,
        v.asset_brief,
        'draft',
        ts,
        ts,
      ]);
      created.push({ id: Number(info.lastInsertRowid || 0), channel, ...v, status: 'draft' });
    }
    appendActivity(state, 'variants_created', { campaign_id: campaign.id, count: created.length, channels });
    return { success: true, output: { campaign_id: campaign.id, variants: created } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
