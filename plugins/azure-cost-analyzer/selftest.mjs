/**
 * Selftest for azure-cost-analyzer plugin.
 *
 * Tests that tools load correctly and gracefully handle missing config.
 * Run: `node selftest.mjs`
 */

import { getAzureConfig } from './tools/lib.mjs';
import { call as listSubs } from './tools/list-subscriptions.mjs';
import { call as costByService } from './tools/cost-by-service.mjs';
import { call as budgetAlerts } from './tools/budget-alerts.mjs';
import { call as resourcesByType } from './tools/resources-by-type.mjs';
import { call as costByDimension } from './tools/cost-by-dimension.mjs';
import { call as costTrend } from './tools/cost-trend.mjs';

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// ── Mock state with empty config ──
const emptyState = {
  patch(key, val) { /* no-op for test */ },
  _configFields: [
    { name: 'subscription_id', default: null },
    { name: 'tenant_id', default: null },
    { name: 'client_id', default: null },
    { name: 'client_secret', default: null },
    { name: 'currency', default: 'USD' },
  ],
  getConfig(key) {
    const f = this._configFields.find(x => x.name === key);
    return f?.default ?? null;
  },
};

// ── Mock state with full config ──
const fullState = {
  patch(key, val) { /* no-op for test */ },
  workplaneUpdates: [],
  upsertWorkplaneWidgets(widgets, options) { this.workplaneUpdates.push({ widgets, options }); },
  _configFields: [
    { name: 'subscription_id', default: null },
    { name: 'tenant_id', default: null },
    { name: 'client_id', default: null },
    { name: 'client_secret', default: null },
    { name: 'currency', default: 'USD' },
  ],
  values: {
    subscription_id: 'sub-abc-123',
    tenant_id: 'tenant-xyz-789',
    client_id: 'client-000',
    client_secret: 'secret-value',
    currency: 'EUR',
  },
  getConfig(key) {
    return this.values[key] !== undefined ? this.values[key] : null;
  },
};

console.log('\nazure-cost-analyzer selftest');

// ── lib.mjs ──
ok('getAzureConfig returns not-ready when empty', !getAzureConfig(emptyState).ready);
ok('getAzureConfig returns ready when configured', getAzureConfig(fullState).ready);
ok('getAzureConfig reports 4 missing fields', getAzureConfig(emptyState).missing.length === 4);
ok('getAzureConfig returns EUR currency', getAzureConfig(fullState).currency === 'EUR');

// ── list-subscriptions.mjs ──
{
  const result = await listSubs({}, { state: emptyState });
  ok('list-subscriptions fails gracefully when config missing', !result.success);
  ok('list-subscriptions returns error message', typeof result.output === 'string');
}
{
  const result = await listSubs({}, { state: fullState });
  ok('list-subscriptions succeeds with config', result.success);
  ok('list-subscriptions returns subscription data', result.output?.subscription_id === 'sub-abc-123');
  ok('list-subscriptions returns EUR', result.output?.currency === 'EUR');
  ok('list-subscriptions publishes typed workplane metrics', fullState.workplaneUpdates.at(-1)?.widgets?.every(w => w.type === 'metric'));
}

// ── cost-by-service.mjs ──
{
  const result = await costByService({ days: 7 }, { state: fullState });
  ok('cost-by-service succeeds', result.success);
  ok('cost-by-service respects days param', result.output?.period_days === 7);
  ok('cost-by-service returns services array', Array.isArray(result.output?.services));
  ok('cost-by-service publishes chart, Three.js scene, and table widgets', fullState.workplaneUpdates.at(-1)?.widgets?.map(w => w.type).join(',') === 'bar_chart,three_scene,table');
}
{
  const result = await costByService({ days: 999 }, { state: fullState });
  ok('cost-by-service clamps days to 90', result.output?.period_days === 90);
}

// ── budget-alerts.mjs ──
{
  const result = await budgetAlerts({ threshold_percent: 50 }, { state: fullState });
  ok('budget-alerts succeeds', result.success);
  ok('budget-alerts returns budgets array', Array.isArray(result.output?.budgets));
}

// ── resources-by-type.mjs ──
{
  const result = await resourcesByType({}, { state: fullState });
  ok('resources-by-type succeeds', result.success);
  ok('resources-by-type returns resource_types array', Array.isArray(result.output?.resource_types));
  ok('resources-by-type returns total', typeof result.output?.total === 'number');
}
{
  const result = await resourcesByType({ days: 7, filter_type: 'AKS Clusters' }, { state: fullState });
  ok('resources-by-type respects days param', result.output?.period_days === 7);
}

// ── cost-by-dimension.mjs ──
{
  const result = await costByDimension({ dimension: 'region' }, { state: fullState });
  ok('cost-by-dimension succeeds', result.success);
  ok('cost-by-dimension returns values array', Array.isArray(result.output?.values));
  ok('cost-by-dimension respects dimension param', result.output?.dimension === 'region');
}
{
  const result = await costByDimension({ dimension: 'resource_group', days: 14 }, { state: fullState });
  ok('cost-by-dimension returns resource_group', result.output?.dimension === 'resource_group');
}

// ── cost-trend.mjs ──
{
  const result = await costTrend({ days: 30 }, { state: fullState });
  ok('cost-trend succeeds', result.success);
  ok('cost-trend returns daily_costs array', Array.isArray(result.output?.daily_costs));
  ok('cost-trend returns correct number of days', result.output?.daily_costs.length === 30);
  ok('cost-trend publishes a line chart widget', fullState.workplaneUpdates.at(-1)?.widgets?.[0]?.type === 'line_chart');
}
{
  const result = await costTrend({ days: 7 }, { state: fullState });
  ok('cost-trend returns 7 days', result.output?.daily_costs.length === 7);
}
{
  const result = await costTrend({}, { state: emptyState });
  ok('cost-trend fails gracefully when config missing', !result.success);
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
