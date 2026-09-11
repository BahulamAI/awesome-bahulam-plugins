export function requireState(options = {}) {
  if (!options.state) throw new Error('Campaign Studio state is unavailable.');
  return options.state;
}

export async function stateOf(options = {}) {
  const state = await requireState(options);
  return state;
}

export function nowIso() {
  return new Date().toISOString();
}

export function json(value) {
  return JSON.stringify(value ?? null);
}

export function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function rows(state, sql, params = []) {
  return state.query(sql, params);
}

export function one(state, sql, params = []) {
  return rows(state, sql, params)[0] || null;
}

export function run(state, sql, params = []) {
  return state.query(sql, params);
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'campaign';
}

export function normalizeChannels(channels = []) {
  const allowed = new Set(['x', 'linkedin', 'instagram', 'email', 'blog']);
  const list = Array.isArray(channels) ? channels : String(channels || '').split(',');
  const out = list.map(c => String(c).trim().toLowerCase()).filter(c => allowed.has(c));
  return out.length ? [...new Set(out)] : ['x', 'linkedin'];
}

export function campaignById(state, campaignId) {
  const id = Number(campaignId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('campaign_id must be a positive integer.');
  const campaign = one(state, 'SELECT * FROM campaigns WHERE id = ?', [id]);
  if (!campaign) throw new Error(`Campaign not found: ${id}`);
  campaign.channels = parseJson(campaign.channels, []);
  return campaign;
}

export function appendActivity(state, type, payload) {
  if (typeof state.append === 'function') {
    state.append('campaign_activity', { type, ...payload });
  }
}
