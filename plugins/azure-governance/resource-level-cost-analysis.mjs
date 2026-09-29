/**
 * Resource-level cost analysis for subscription 1069c761-6716-4b06-a1d7-1f4d2f70f2c5
 * Sep 1–28, 2026.
 *
 * Uses exactly one azure_inventory_scan with cost_dimensions = ['resource_group','resource']
 * followed by exactly one azure_cost_report.
 *
 * Clearly distinguishes Azure-quoted savings (from Advisor / native benefit recommendations)
 * from inferred opportunities (utilization-based right-sizing, idle-resource detection,
 * commitment screening).
 */

import { call as scanCall } from './tools/azure-inventory-scan.mjs';
import { call as costCall } from './tools/azure-cost-report.mjs';

// ---------------------------------------------------------------------------
// In-memory state store (matches what run-governance.mjs does)
// ---------------------------------------------------------------------------
const rows = [];
const stateStore = {
  append(stream, payload) {
    const id = rows.length + 1;
    rows.push({ id, stream, payload, created_at: new Date().toISOString() });
    return id;
  },
  list(stream, { limit = 50, order = 'desc' } = {}) {
    const filtered = rows.filter(r => r.stream === stream);
    return (order === 'asc' ? filtered : [...filtered].reverse()).slice(0, limit);
  },
};
const options = { state: Promise.resolve(stateStore) };

// ---------------------------------------------------------------------------
// Subscription & time range
// ---------------------------------------------------------------------------
const SUBSCRIPTION_ID = '1069c761-6716-4b06-a1d7-1f4d2f70f2c5';
const START_DATE = '2026-09-01';
const END_DATE   = '2026-09-28';

// ---------------------------------------------------------------------------
// STEP 1 — Inventory scan with cost dimensions
// ---------------------------------------------------------------------------
console.log('=== STEP 1: Azure Inventory Scan (with cost dimensions) ===\n');

const scan = await scanCall({
  name: 'Resource-level cost analysis',
  collect_from: 'azure_cli',
  subscription_id: SUBSCRIPTION_ID,
  include_costs: true,
  cost_dimensions: ['resource_group', 'resource'],
  cost_start_date: START_DATE,
  cost_end_date: END_DATE,
  use_resource_graph: true,
}, options);

if (!scan.success) {
  console.error('SCAN FAILED:', scan.output);
  process.exit(1);
}

console.log(`  Status:              ${scan.success}`);
console.log(`  Subscription count:  ${scan.output.subscription_count}`);
console.log(`  Resource groups:     ${scan.output.resource_group_count}`);
console.log(`  Resources:           ${scan.output.resource_count}`);
console.log(`  Total cost:          ${scan.output.total_cost_display}`);
console.log(`  Collector:           ${scan.output.collector?.engine || 'unknown'}`);
if (scan.output.collector?.warnings?.length) {
  for (const w of scan.output.collector.warnings) console.log(`  WARNING: ${w}`);
}
console.log();

const scanId = scan.output.id;

// ---------------------------------------------------------------------------
// STEP 2 — Cost report (groups by resource, rich optimization output)
// ---------------------------------------------------------------------------
console.log('=== STEP 2: Cost Report (resource-level grouping) ===\n');

const cost = await costCall({
  scan_id: scanId,
  group_by: 'resource',
}, options);

if (!cost.success) {
  console.error('COST FAILED:', cost.output);
  process.exit(1);
}

const o = cost.output;

console.log(`  Total cost:          ${o.total_cost_display}`);
console.log(`  Groups:              ${o.groups.length} (group_by = ${o.group_by})`);
console.log(`  Resource groups:     ${o.resource_groups.length} (with per-resource breakdown)`);
console.log(`  Tagged cost:         ${o.total_cost_display}`);
console.log(`  Untagged cost:       ${o.untagged_cost_display}`);
console.log(`  Anomalies:           ${o.anomalies.length}`);
console.log(`  Idle expensive:      ${o.optimization.idle_expensive_resources.length}`);
console.log(`  Right-sizing recs:   ${o.optimization.rightsizing_recommendations.length}`);
console.log(`  Commitment cand.:    ${o.optimization.commitment_candidates.length}`);
console.log(`  Native commit. recs: ${o.optimization.native_commitment_recommendations.length}`);
console.log();

// ---------------------------------------------------------------------------
// REPORT — Resource-level cost by resource group
// ---------------------------------------------------------------------------
console.log('='.repeat(80));
console.log('RESOURCE-LEVEL COST ANALYSIS — Sep 1–28, 2026');
console.log('='.repeat(80));
console.log();

for (const rg of o.resource_groups) {
  console.log(`${'─'.repeat(72)}`);
  console.log(`RESOURCE GROUP: ${rg.name}`);
  console.log(`  Total cost:      ${rg.cost_display} (${((rg.cost_usd / o.total_cost_usd) * 100).toFixed(1)}% of total)`);
  console.log(`  Resources:       ${rg.resources.length}`);
  console.log();

  for (const res of rg.resources) {
    const pctOfGroup = rg.cost_usd > 0 ? ((res.cost_usd / rg.cost_usd) * 100).toFixed(1) : '0.0';
    const pctOfTotal = o.total_cost_usd > 0 ? ((res.cost_usd / o.total_cost_usd) * 100).toFixed(2) : '0.00';
    console.log(`  ${res.name || '(unnamed)'}`);
    console.log(`    Type:          ${res.type || 'unknown'}`);
    console.log(`    Cost:          ${res.cost_display}  (${pctOfGroup}% of group, ${pctOfTotal}% of total)`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// OPTIMIZATION — Clearly distinguishing Azure-quoted vs. inferred
// ---------------------------------------------------------------------------
console.log('='.repeat(80));
console.log('OPTIMIZATION SUMMARY');
console.log('='.repeat(80));
console.log();

// -- Idle expensive resources (inferred) --
if (o.optimization.idle_expensive_resources.length) {
  console.log('── IDLE-EXPENSIVE RESOURCES (Inferred — based on observed state & metrics)');
  console.log(`   Threshold: min idle cost >= $25 USD`);
  for (const idle of o.optimization.idle_expensive_resources) {
    console.log(`   • ${idle.name || idle.resource_id}`);
    console.log(`     Type: ${idle.type}  |  Observed cost: ${idle.observed_cost_display}`);
    console.log(`     Evidence: ${idle.reason}`);
  }
  console.log(`   Total idle-observed cost: ${o.optimization.summary.idle_observed_cost_display}`);
  console.log();
} else {
  console.log('── IDLE-EXPENSIVE RESOURCES: None detected.');
  console.log();
}

// -- Right-sizing recommendations (mixed: Azure-quoted + inferred) --
if (o.optimization.rightsizing_recommendations.length) {
  console.log('── RIGHT-SIZING RECOMMENDATIONS');
  const advisorRecs = o.optimization.rightsizing_recommendations.filter(r => r.source === 'azure_advisor');
  const inferredRecs = o.optimization.rightsizing_recommendations.filter(r => r.source !== 'azure_advisor');

  if (advisorRecs.length) {
    console.log('   [AZURE-QUOTED — from Azure Advisor]');
    for (const rec of advisorRecs) {
      console.log(`   • ${rec.resource_id || '(resource)'}`);
      console.log(`     Recommendation: ${rec.recommendation}`);
      console.log(`     Solution:       ${rec.solution || 'N/A'}`);
      console.log(`     Annual savings: ${rec.estimated_annual_savings_display} (source currency: ${rec.source_currency})`);
      console.log(`     Source:         ${rec.source}`);
    }
    console.log();
  }

  if (inferredRecs.length) {
    console.log('   [INFERRED — from utilization analysis]');
    for (const rec of inferredRecs) {
      console.log(`   • ${rec.resource_id || '(resource)'}`);
      console.log(`     Recommendation: ${rec.recommendation}`);
      console.log(`     CPU avg:        ${rec.average_cpu_percent}%  |  Memory avg: ${rec.average_memory_percent ?? 'N/A'}%`);
      console.log(`     Observed cost:  ${rec.observed_cost_display}`);
      console.log(`     Source:         ${rec.source}`);
    }
    console.log();
  }

  console.log(`   Advisor annual savings: ${o.optimization.summary.advisor_estimated_annual_savings_display}`);
  console.log();
} else {
  console.log('── RIGHT-SIZING RECOMMENDATIONS: None found.');
  console.log();
}

// -- Commitment candidates (inferred screening) --
if (o.optimization.commitment_candidates.length) {
  console.log('── COMMITMENT CANDIDATES (Inferred — screening recommendation, not a purchase instruction)');
  console.log(`   Threshold: min ${o.optimization.commitment_candidates[0].observed_days || '?'} days observed, min $100 cost, daily variation ≤ 0.25`);
  for (const cc of o.optimization.commitment_candidates) {
    console.log(`   • Service: ${cc.service}  |  SKU: ${cc.sku}`);
    console.log(`     Observed cost:  ${cc.observed_cost_display}  (${cc.observed_days} days)`);
    console.log(`     Avg daily:      ${cc.average_daily_cost_display}`);
    console.log(`     Projected/mo:   ${cc.projected_monthly_cost_display}`);
    console.log(`     Daily variation: ${cc.daily_variation}`);
    console.log(`     Options:        ${cc.commitment_options.join(', ')}`);
    console.log(`     Caution:        ${cc.recommendation}`);
  }
  console.log();
} else {
  console.log('── COMMITMENT CANDIDATES: None (cost, duration, or variation thresholds not met).');
  console.log();
}

// -- Native commitment recommendations (Azure-quoted) --
if (o.optimization.native_commitment_recommendations.length) {
  console.log('── NATIVE COMMITMENT RECOMMENDATIONS (Azure-quoted — from Azure Benefit Recommendations)');
  for (const nc of o.optimization.native_commitment_recommendations) {
    console.log(`   • Resource: ${nc.resource_id || nc.scope || '(subscription)'}`);
    console.log(`     Type:    ${nc.kind || nc.type || 'N/A'}`);
    console.log(`     Savings: ${nc.estimated_savings_display}`);
    console.log(`     Hourly:  ${nc.hourly_commitment_display}`);
    console.log(`     Source:  ${nc.source}`);
  }
  console.log(`   Total native estimated savings: ${o.optimization.summary.native_estimated_savings_display}`);
  console.log();
} else {
  console.log('── NATIVE COMMITMENT RECOMMENDATIONS: None returned from Azure.');
  console.log();
}

// -- Anomalies --
if (o.anomalies.length) {
  console.log('── COST ANOMALIES');
  for (const a of o.anomalies) {
    console.log(`   • ${a.date}: ${a.cost_display} vs baseline ${a.baseline_display} (+${a.increase_display})`);
  }
  console.log();
}

// -- Forecast --
if (o.forecast) {
  console.log(`── MONTH-END FORECAST`);
  console.log(`   Observed days:              ${o.forecast.observed_days}`);
  console.log(`   Avg daily cost:             ${o.forecast.average_daily_cost_display}`);
  console.log(`   Projected month-end:        ${o.forecast.month_end_forecast_display}`);
  console.log(`   Remaining days in month:    ${o.forecast.remaining_days_in_month}`);
  console.log();
}

// ---------------------------------------------------------------------------
// SUMMARY TABLE
// ---------------------------------------------------------------------------
console.log('='.repeat(80));
console.log('COST SUMMARY');
console.log('='.repeat(80));
console.log(`  Subscription:        ${SUBSCRIPTION_ID}`);
console.log(`  Period:              ${START_DATE} through ${END_DATE}`);
console.log(`  Total cost:          ${o.total_cost_display}`);
console.log(`  Resource groups:     ${o.resource_groups.length}`);
console.log(`  Resources billed:    ${o.groups.length}`);
console.log(`  Untagged:            ${o.untagged_cost_display}`);
console.log();

console.log('SAVINGS BREAKDOWN');
console.log(`  Azure-quoted (Advisor annual):     ${o.optimization.summary.advisor_estimated_annual_savings_display}`);
console.log(`  Azure-quoted (native commitment):  ${o.optimization.summary.native_estimated_savings_display}`);
console.log(`  Inferred (idle-observed costs):    ${o.optimization.summary.idle_observed_cost_display}`);
console.log(`  Inferred (commitment candidates):  ${o.optimization.commitment_candidates.length > 0 ? 'See commitment candidates above' : 'None'}`);
console.log();
console.log('NOTE: Azure-quoted savings come directly from Azure Advisor and Azure Benefit');
console.log('      Recommendations APIs. Inferred opportunities are heuristic-based screens');
console.log('      using utilization metrics, cost patterns, and resource state — they are');
console.log('      NOT guarantees and require manual review before action.');