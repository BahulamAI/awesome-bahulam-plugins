import { DatabaseSync } from 'node:sqlite';
import { call as campaignCreate } from './tools/campaign-create.mjs';
import { call as copyVariantCreate } from './tools/copy-variant-create.mjs';
import { call as approvalRecord } from './tools/approval-record.mjs';
import { call as postSchedule } from './tools/post-schedule.mjs';
import { call as metricsRecord } from './tools/metrics-record.mjs';
import { call as campaignReport } from './tools/campaign-report.mjs';

let failures = 0;
function ok(label, cond) {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
}

const DDL = `
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, objective TEXT NOT NULL,
  audience TEXT NOT NULL, offer TEXT NOT NULL, channels TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX campaigns_name_idx ON campaigns(name);
CREATE TABLE variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, channel TEXT NOT NULL,
  headline TEXT NOT NULL, body TEXT NOT NULL, call_to_action TEXT NOT NULL,
  asset_brief TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, variant_id INTEGER,
  reviewer TEXT NOT NULL, decision TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, variant_id INTEGER,
  channel TEXT NOT NULL, status TEXT NOT NULL, scheduled_at TEXT, published_at TEXT,
  url TEXT NOT NULL DEFAULT '', utm_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  spend REAL NOT NULL DEFAULT 0, captured_at TEXT NOT NULL
);
`;

function makeState() {
  const db = new DatabaseSync(':memory:');
  db.exec(DDL);
  const kv = new Map();
  const records = [];
  return {
    get(key, fallback = null) {
      return kv.has(key) ? JSON.parse(kv.get(key)) : fallback;
    },
    set(key, value) {
      kv.set(key, JSON.stringify(value));
      return value;
    },
    patch(key, value) {
      const next = { ...(this.get(key, {}) || {}), ...value };
      this.set(key, next);
      return next;
    },
    append(stream, payload) {
      records.push({ id: records.length + 1, stream, payload, created_at: new Date(0).toISOString() });
      return records.length;
    },
    list(stream, { limit = 50, order = 'desc' } = {}) {
      const rows = records.filter(row => row.stream === stream);
      return (order === 'asc' ? rows : [...rows].reverse()).slice(0, limit);
    },
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      const upper = String(sql).trim().slice(0, 6).toUpperCase();
      if (upper === 'SELECT') return stmt.all(...params);
      const info = stmt.run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    close() {
      db.close();
    },
  };
}

const state = makeState();
const options = { state: Promise.resolve(state) };
try {
  const created = await campaignCreate({
    name: 'Plugin Launch',
    objective: 'Explain Bahulam plugins as outcome runtimes.',
    audience: 'engineering leaders',
    offer: 'install a multi-agent campaign workflow',
    channels: ['x', 'linkedin', 'email'],
  }, options);
  ok('campaign_create succeeds', created.success && created.output.campaign_id === 1);
  ok('campaign state is stored', state.get('campaign_state').active_campaign_id === 1);

  const variants = await copyVariantCreate({ campaign_id: 1, tone: 'pragmatic' }, options);
  ok('copy_variant_create creates channel variants', variants.success && variants.output.variants.length === 3);

  const approval = await approvalRecord({ campaign_id: 1, variant_id: 1, reviewer: 'selftest', decision: 'approved' }, options);
  ok('approval_record stores decision', approval.success && approval.output.decision === 'approved');

  const scheduled = await postSchedule({ campaign_id: 1, landing_url: 'https://bahulam.ai/plugins' }, options);
  ok('post_schedule creates simulated posts', scheduled.success && scheduled.output.posts.length === 3);
  ok('post_schedule returns simulated mode', scheduled.output.mode === 'simulated');

  const metric = await metricsRecord({ post_id: 1, impressions: 1000, clicks: 85, conversions: 8, spend: 42 }, options);
  ok('metrics_record stores metrics', metric.success && metric.output.clicks === 85);

  const report = await campaignReport({ campaign_id: 1 }, options);
  ok('campaign_report computes totals', report.success && report.output.totals.impressions === 1000);
  ok('campaign_report gives recommendation', Boolean(report.output.recommendation));
  ok('activity log records outcomes', state.list('campaign_activity').length >= 5);
} finally {
  state.close();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nALL CAMPAIGN-STUDIO SELFTESTS PASSED');
