import { appendActivity, json, normalizeChannels, nowIso, one, run, stateOf } from './lib.mjs';

export async function call(args = {}, options = {}) {
  try {
    const state = await stateOf(options);
    const name = String(args.name || '').trim();
    const objective = String(args.objective || '').trim();
    const audience = String(args.audience || '').trim();
    const offer = String(args.offer || '').trim();
    if (!name || !objective || !audience || !offer) {
      return { success: false, output: 'name, objective, audience, and offer are required.' };
    }
    const channels = normalizeChannels(args.channels);
    const existing = one(state, 'SELECT id FROM campaigns WHERE name = ?', [name]);
    const ts = nowIso();
    let id;
    if (existing) {
      id = Number(existing.id);
      run(state, 'UPDATE campaigns SET objective = ?, audience = ?, offer = ?, channels = ?, updated_at = ? WHERE id = ?', [
        objective,
        audience,
        offer,
        json(channels),
        ts,
        id,
      ]);
    } else {
      const info = run(state, 'INSERT INTO campaigns (name, objective, audience, offer, channels, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        name,
        objective,
        audience,
        offer,
        json(channels),
        'draft',
        ts,
        ts,
      ]);
      id = Number(info.lastInsertRowid || info.lastID || 0);
    }
    state.set?.('campaign_state', { active_campaign_id: id, active_campaign: name, status: 'draft', channels });
    appendActivity(state, existing ? 'campaign_updated' : 'campaign_created', { campaign_id: id, name, channels });
    return { success: true, output: { campaign_id: id, name, objective, audience, offer, channels, status: 'draft' } };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
