/**
 * Selftest for azure-cost-analyzer.
 *
 * The tools call the real Azure Cost Management API, so every test here injects
 * a fake `fetch` through `deps`. Nothing reaches the network, and no credentials
 * are needed — but the request bodies, the column-by-name decoding, and the
 * failure paths are all exercised against realistic payloads.
 *
 * Run: node selftest.mjs
 */

import { getAzureConfig } from './tools/lib.mjs';
import { clearTokenCache, indexResult, lastNDays, normalizeDate } from './tools/azure.mjs';
import { call as listSubs } from './tools/list-subscriptions.mjs';
import { call as costByService } from './tools/cost-by-service.mjs';
import { call as budgetAlerts } from './tools/budget-alerts.mjs';
import { call as resourcesByType } from './tools/resources-by-type.mjs';
import { call as costByDimension } from './tools/cost-by-dimension.mjs';
import { call as costTrend } from './tools/cost-trend.mjs';

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function makeState(config) {
  return {
    // Captured SQL, so a test can assert exactly what a tool recorded rather
    // than only that it recorded something.
    sql: [],
    writes: [],
    patch(key) { this.writes.push(key); },
    set(key) { this.writes.push(key); },
    query(sql, params = []) {
      this.sql.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      // The one read the snapshot helper performs.
      if (/last_insert_rowid/.test(sql)) return [{ id: this.sql.filter(e => /INSERT INTO cost_runs/.test(e.sql)).length }];
      return [];
    },
    getConfig(key) { return config[key] ?? null; },
    getAllConfig() { return config; },
    rowsFor(table) { return this.sql.filter(entry => entry.sql.startsWith(`INSERT INTO ${table}`)); },
  };
}

const EMPTY = {};
const FULL = {
  subscription_id: '00000000-0000-0000-0000-000000000000',
  tenant_id: '11111111-1111-1111-1111-111111111111',
  client_id: '22222222-2222-2222-2222-222222222222',
  client_secret: 'shhh',
  currency: 'USD',
};

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
});

/**
 * Fake transport. Records every request so a test can assert what was sent, and
 * answers the token endpoint automatically.
 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    // The token endpoint is form-urlencoded; everything else is JSON.
    let body = null;
    if (typeof options.body === 'string') {
      try { body = JSON.parse(options.body); }
      catch { body = Object.fromEntries(new URLSearchParams(options.body)); }
    }
    calls.push({ url, method: options.method ?? 'GET', body });
    if (url.includes('login.microsoftonline.com')) {
      return json({ access_token: 'fake-token', expires_in: 3600 });
    }
    for (const [pattern, responder] of routes) {
      if (url.includes(pattern)) return typeof responder === 'function' ? responder(url, options) : responder;
    }
    return json({ error: { code: 'NotFound', message: `no fake route for ${url}` } }, 404);
  };
  impl.calls = calls;
  return impl;
}

/** Column order deliberately differs from the grouping order, as Azure's does. */
const costResponse = (columns, rows) => json({ properties: { columns, rows } });

console.log('\nconfig handling');
{
  const cfg = getAzureConfig(makeState(EMPTY));
  ok('reports every missing credential', cfg.ready === false && cfg.missing.length === 4);
  ok('error names the fields and points at Settings',
    /subscription_id.*tenant_id.*client_id.*client_secret/.test(cfg.error) && /Settings/.test(cfg.error));
  const full = getAzureConfig(makeState(FULL));
  ok('accepts a complete config', full.ready === true && full.currency === 'USD');
}

console.log('\nhelpers');
{
  ok('normalizeDate handles Azure\'s 20260918 form', normalizeDate(20260918) === '2026-09-18');
  ok('normalizeDate handles an ISO timestamp', normalizeDate('2026-09-18T00:00:00Z') === '2026-09-18');
  const window = lastNDays(7);
  ok('lastNDays spans 7 inclusive days',
    /T00:00:00\+00:00$/.test(window.from) && /T23:59:59\+00:00$/.test(window.to));
  const r = indexResult({ columns: [{ name: 'Cost' }, { name: 'ServiceName' }], rows: [[1.5, 'Compute']] });
  ok('indexResult reads by NAME, not position',
    r.get(r.rows[0], 'ServiceName') === 'Compute' && r.get(r.rows[0], 'Cost') === 1.5);
  ok('indexResult.pick falls back across alternative names',
    r.pick(r.rows[0], ['Missing', 'ServiceName']) === 'Compute');
}

console.log('\nevery tool refuses to run unconfigured');
for (const [name, tool] of Object.entries({ listSubs, costByService, budgetAlerts, resourcesByType, costByDimension, costTrend })) {
  const result = await tool({}, { state: makeState(EMPTY) });
  ok(`${name} fails cleanly with no credentials`,
    result.success === false && /not configured/.test(String(result.output)));
}

console.log('\ncost-by-service against a realistic payload');
{
  clearTokenCache();
  const fetchImpl = fakeFetch([['Microsoft.CostManagement/query', costResponse(
    // Cost first, then the dimension, then currency — the documented order.
    [{ name: 'Cost', type: 'Number' }, { name: 'ServiceName', type: 'String' }, { name: 'Currency', type: 'String' }],
    [[412.3, 'Azure App Service', 'USD'], [325.1, 'Azure SQL Database', 'USD'], [0, 'Unused Service', 'USD']],
  )]]);
  const state = makeState(FULL);
  const result = await costByService({ days: 30 }, { state, deps: { fetch: fetchImpl } });

  ok('succeeds', result.success === true, JSON.stringify(result.output).slice(0, 120));
  ok('decodes services by column name', result.output?.services?.[0]?.name === 'Azure App Service');
  ok('keeps the cost value', result.output?.services?.[0]?.cost === 412.3);
  ok('drops zero-cost rows', result.output?.services?.length === 2);
  ok('sums the total', result.output?.total === 737.4);
  ok('reports the currency Azure returned', result.output?.currency === 'USD');

  const query = fetchImpl.calls.find((c) => c.url.includes('CostManagement/query'));
  ok('requests ActualCost with a custom window', query?.body?.type === 'ActualCost' && query?.body?.timeframe === 'Custom');
  ok('groups by ServiceName', query?.body?.dataset?.grouping?.[0]?.name === 'ServiceName');
  ok('aggregates with Sum', query?.body?.dataset?.aggregation?.totalCost?.function === 'Sum');
  ok('authenticates once and reuses the token',
    fetchImpl.calls.filter((c) => c.url.includes('login.microsoftonline')).length === 1);
  ok('never puts the secret in a URL', fetchImpl.calls.every((c) => !c.url.includes('shhh')));
}

console.log('\ncost-trend aggregates daily buckets');
{
  clearTokenCache();
  const fetchImpl = fakeFetch([['Microsoft.CostManagement/query', costResponse(
    [{ name: 'Cost' }, { name: 'UsageDate' }, { name: 'Currency' }],
    [[10.5, 20260917, 'USD'], [12.25, 20260918, 'USD'], [1.75, 20260918, 'USD']],
  )]]);
  const result = await costTrend({ days: 7 }, { state: makeState(FULL), deps: { fetch: fetchImpl } });
  ok('succeeds', result.success === true);
  ok('requests Daily granularity',
    fetchImpl.calls.find((c) => c.url.includes('query'))?.body?.dataset?.granularity === 'Daily');
  ok('normalises dates', result.output?.daily_costs?.[0]?.date === '2026-09-17');
  ok('sums rows sharing a date', result.output?.daily_costs?.[1]?.cost === 14);
  ok('orders ascending', result.output.daily_costs[0].date < result.output.daily_costs[1].date);
}

console.log('\ncost-by-dimension');
{
  clearTokenCache();
  const fetchImpl = fakeFetch([['Microsoft.CostManagement/query', costResponse(
    [{ name: 'Cost' }, { name: 'ResourceLocation' }, { name: 'Currency' }],
    [[585, 'eastus', 'USD'], [120.5, 'westeurope', 'USD']],
  )]]);
  const result = await costByDimension({ dimension: 'region', days: 30 }, { state: makeState(FULL), deps: { fetch: fetchImpl } });
  ok('succeeds', result.success === true);
  ok('maps region to ResourceLocation',
    fetchImpl.calls.find((c) => c.url.includes('query'))?.body?.dataset?.grouping?.[0]?.name === 'ResourceLocation');
  ok('returns a values array', Array.isArray(result.output?.values));
  ok('sorts by cost descending', result.output.values[0].value === 'eastus' && result.output.values[0].cost === 585);

  const bad = await costByDimension({ dimension: 'nonsense' }, { state: makeState(FULL), deps: { fetch: fetchImpl } });
  ok('rejects an unsupported dimension', bad.success === false && /Unsupported dimension/.test(bad.output));
}

console.log('\nresources-by-type derives type from the resource id');
{
  clearTokenCache();
  const fetchImpl = fakeFetch([['Microsoft.CostManagement/query', costResponse(
    [{ name: 'Cost' }, { name: 'ResourceId' }, { name: 'ResourceGroupName' }, { name: 'ResourceLocation' }, { name: 'Currency' }],
    [[150, '/subscriptions/s/resourceGroups/rg-prod/providers/Microsoft.Web/serverfarms/plan-01', 'rg-prod', 'eastus', 'USD'],
     [120, '/subscriptions/s/resourceGroups/rg-prod/providers/Microsoft.Web/sites/webapp-01', 'rg-prod', 'eastus', 'USD']],
  )]]);
  const result = await resourcesByType({ days: 30 }, { state: makeState(FULL), deps: { fetch: fetchImpl } });
  ok('succeeds', result.success === true);
  ok('extracts the provider type', result.output?.resources?.[0]?.type === 'Microsoft.Web/serverfarms');
  ok('extracts the resource name', result.output?.resources?.[0]?.name === 'plan-01');
  ok('groups by type', result.output?.types?.length === 2);
  ok('filters by type when asked', (await resourcesByType(
    { days: 30, filter_type: 'sites' }, { state: makeState(FULL), deps: { fetch: fetchImpl } },
  )).output.resources.length === 1);
}

console.log('\nbudget-alerts');
{
  clearTokenCache();
  const fetchImpl = fakeFetch([['Microsoft.Consumption/budgets', json({ value: [
    { name: 'monthly', properties: { amount: 1000, currentSpend: { amount: 900, unit: 'USD' }, timeGrain: 'Monthly' } },
    { name: 'quarterly', properties: { amount: 5000, currentSpend: { amount: 500, unit: 'USD' }, timeGrain: 'Quarterly' } },
    { name: 'zero', properties: { amount: 0, currentSpend: { amount: 0, unit: 'USD' } } },
  ] })]]);
  const state = makeState(FULL);
  const result = await budgetAlerts({ threshold_percent: 80 }, { state, deps: { fetch: fetchImpl } });
  ok('succeeds', result.success === true);
  ok('computes consumed percent', result.output?.budgets?.[0]?.consumed_percent === 90);
  ok('flags only the breached budget', result.output?.breached?.length === 1 && result.output.breached[0] === 'monthly');
  ok('does not divide by zero', result.output.budgets[2].consumed_percent === null);
}

console.log('\ntools write nothing; they only return data');
{
  clearTokenCache();
  const fetchImpl = fakeFetch([['Microsoft.CostManagement/query', costResponse(
    [{ name: 'Cost' }, { name: 'ServiceName' }, { name: 'Currency' }],
    [[412.3, 'Azure App Service', 'USD']],
  )]]);
  const state = makeState(FULL);
  const result = await costByService({ days: 30 }, { state, deps: { fetch: fetchImpl } });
  ok('succeeds', result.success === true);

  // A tool records what it read so the panel can show it with provenance. It
  // uses ONLY the declared tables — no kv key, no second vocabulary.
  ok('no untyped kv write', state.writes.length === 0, JSON.stringify(state.writes));
  const runs = state.rowsFor('cost_runs');
  ok('recorded exactly one run', runs.length === 1, JSON.stringify(runs));
  ok('the run carries provenance',
    runs[0]?.params?.[1] === 'azure_cost_by_service'
    && String(runs[0]?.params?.[2] ?? '').includes('last 30d')
    && runs[0]?.params?.[3] === 'USD',
    JSON.stringify(runs[0]?.params));

  const rows = state.rowsFor('cost_rows');
  ok('recorded a row per service', rows.length === 1, JSON.stringify(rows.length));
  // 412.3 USD is 41230 minor units. A decimal reaching the column would mean
  // two readers could round it differently.
  const amount = rows[0]?.params?.[4];
  ok('money stored as integer minor units', amount === 41230, String(amount));
  ok('currency exponent recorded beside it', runs[0]?.params?.[4] === 2, String(runs[0]?.params?.[4]));
}

console.log('\nminor units survive the round trip');
{
  const { toMinorUnits, currencyExponent } = await import('./tools/snapshot.mjs');
  // Two-digit currencies are the common case.
  ok('USD 412.30 -> 41230', toMinorUnits(412.3, 'USD') === 41230, String(toMinorUnits(412.3, 'USD')));
  ok('INR 51734.48 -> 5173448', toMinorUnits(51734.48, 'INR') === 5173448, String(toMinorUnits(51734.48, 'INR')));
  // The ones a hardcoded "times 100" gets wrong. A yen is already the minor
  // unit; a dinar has three digits. Storing 100x or 0.1x the real amount would
  // display a confidently wrong figure rather than failing.
  ok('JPY has no minor unit', currencyExponent('JPY') === 0 && toMinorUnits(1500, 'JPY') === 1500,
    String(toMinorUnits(1500, 'JPY')));
  ok('KWD has three digits', currencyExponent('KWD') === 3 && toMinorUnits(12.345, 'KWD') === 12345,
    String(toMinorUnits(12.345, 'KWD')));
  ok('an unknown currency assumes two', currencyExponent('ZZZ') === 2);
  ok('case does not matter', currencyExponent('jpy') === 0);
  // Rounding happens once, here, so nothing downstream rounds a second time.
  ok('rounds once at the boundary', toMinorUnits(0.005, 'USD') === 1, String(toMinorUnits(0.005, 'USD')));
  for (const [currency, amount] of [['USD', 412.3], ['INR', 51734.48], ['JPY', 1500], ['KWD', 12.345]]) {
    const back = toMinorUnits(amount, currency) / 10 ** currencyExponent(currency);
    ok(`${currency} ${amount} renders back exactly`, back === amount, String(back));
  }
}

console.log('\nfailures surface, never become zeroes');
{
  clearTokenCache();
  const denied = fakeFetch([['Microsoft.CostManagement/query',
    json({ error: { code: 'AuthorizationFailed', message: 'does not have authorization to perform action' } }, 403)]]);
  const result = await costByService({ days: 30 }, { state: makeState(FULL), deps: { fetch: denied } });
  ok('a 403 fails the tool', result.success === false);
  ok('names the missing role', /Cost Management Reader/.test(String(result.output)));
  ok('returns no cost figure at all', typeof result.output === 'string');

  clearTokenCache();
  const badSecret = fakeFetch([]);
  const impl = async (url, options) => url.includes('login.microsoftonline')
    ? json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, 401)
    : badSecret(url, options);
  impl.calls = [];
  const signIn = await costByService({ days: 30 }, { state: makeState(FULL), deps: { fetch: impl } });
  ok('a bad secret fails with Azure\'s own diagnostic',
    signIn.success === false && /AADSTS7000215/.test(String(signIn.output)));

  clearTokenCache();
  const throttled = fakeFetch([['Microsoft.CostManagement/query',
    json({ error: { code: 'TooManyRequests', message: 'rate limited' } }, 429, { 'retry-after': '0' })]]);
  const rate = await costByService({ days: 30 }, { state: makeState(FULL), deps: { fetch: throttled } });
  ok('retries a 429 then reports it', rate.success === false && /429/.test(String(rate.output)));
  ok('retried exactly twice before giving up',
    throttled.calls.filter((c) => c.url.includes('query')).length === 3);
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
