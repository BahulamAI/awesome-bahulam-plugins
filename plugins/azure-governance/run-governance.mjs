/**
 * Runs the full Azure governance pipeline against live Azure CLI.
 * Usage: node plugins/azure-governance/run-governance.mjs
 */
import { call as scanCall } from './tools/azure-inventory-scan.mjs';
import { call as costCall } from './tools/azure-cost-report.mjs';
import { call as accessCall } from './tools/azure-access-matrix.mjs';
import { call as securityCall } from './tools/azure-security-findings.mjs';
import { call as tagCall } from './tools/azure-tag-audit.mjs';
import { call as wasteCall } from './tools/azure-waste-report.mjs';
import { call as reportCall } from './tools/azure-governance-report.mjs';

const rows = [];
const stateStore = {
  append(stream, payload) {
    const row = { id: rows.length + 1, stream, payload, created_at: new Date().toISOString() };
    rows.push(row);
    return row.id;
  },
  list(stream, { limit = 50, order = 'desc' } = {}) {
    const filtered = rows.filter(row => row.stream === stream);
    const ordered = order === 'asc' ? filtered : [...filtered].reverse();
    return ordered.slice(0, limit);
  },
};
const options = { state: Promise.resolve(stateStore) };

async function run() {
  console.log('=== STEP 1/7: Azure Inventory Scan (CLI) ===\n');
  const scan = await scanCall({
    name: 'Live Azure estate',
    collect_from: 'azure_cli',
    include_costs: true,
    use_resource_graph: true,
  }, options);
  if (!scan.success) {
    console.error('SCAN FAILED:', scan.output);
    process.exit(1);
  }
  console.log(`  Subscription count: ${scan.output.subscription_count}`);
  console.log(`  Resource groups:     ${scan.output.resource_group_count}`);
  console.log(`  Resources:           ${scan.output.resource_count}`);
  console.log(`  Role assignments:    ${scan.output.role_assignment_count}`);
  console.log(`  Total cost:          ${scan.output.total_cost_display}`);
  console.log(`  Collector:           ${scan.output.collector?.engine || 'unknown'}`);
  if (scan.output.collector?.warnings?.length) {
    for (const w of scan.output.collector.warnings) console.log(`  WARNING: ${w}`);
  }
  console.log();

  const scanId = scan.output.id;

  console.log('=== STEP 2/7: Cost Report ===\n');
  const cost = await costCall({ scan_id: scanId }, options);
  if (!cost.success) { console.error('COST FAILED:', cost.output); process.exit(1); }
  console.log(`  Total cost:          ${cost.output.total_cost_display}`);
  console.log(`  Currency:            ${cost.output.currency}`);
  console.log(`  Untagged spend:      ${cost.output.untagged_cost_display}`);
  console.log(`  Month-end forecast:  ${cost.output.forecast?.month_end_forecast_display || 'N/A'}`);
  if (cost.output.optimization?.rightsizing_recommendations?.length) {
    console.log(`  Right-sizing recs:   ${cost.output.optimization.rightsizing_recommendations.length}`);
  }
  if (cost.output.optimization?.native_commitment_recommendations?.length) {
    console.log(`  Commitment recs:     ${cost.output.optimization.native_commitment_recommendations.length}`);
  }
  console.log();

  console.log('=== STEP 3/7: Access Matrix (RBAC) ===\n');
  const access = await accessCall({ scan_id: scanId, format: 'markdown' }, options);
  if (!access.success) { console.error('ACCESS FAILED:', access.output); process.exit(1); }
  console.log(`  Assignments:         ${access.output.assignment_count}`);
  console.log(`  Privileged:          ${access.output.privileged_count}`);
  console.log(`  Custom privileged:   ${access.output.custom_privileged_count}`);
  console.log(`  Broad scope:         ${access.output.broad_scope_count}`);
  console.log(`  Unknown principals:  ${access.output.unknown_principal_count}`);
  console.log(`  Stale principals:    ${access.output.stale_principal_count}`);
  console.log(`  Inactive principals: ${access.output.inactive_principal_count}`);
  console.log();

  console.log('=== STEP 4/7: Security Findings ===\n');
  const security = await securityCall({ scan_id: scanId }, options);
  if (!security.success) { console.error('SECURITY FAILED:', security.output); process.exit(1); }
  console.log(`  Total findings:      ${security.output.findings?.length || 0}`);
  console.log(`  Compliance score:    ${security.output.summary?.compliance_score_percent}%`);
  console.log(`  Defender score:      ${security.output.summary?.defender_secure_score_percent}%`);
  if (security.output.findings?.length) {
    for (const f of security.output.findings.slice(0, 10)) {
      console.log(`  - [${f.severity}] ${f.control}: ${f.target || ''}`);
    }
    if (security.output.findings.length > 10) console.log(`  ... and ${security.output.findings.length - 10} more`);
  }
  console.log();

  console.log('=== STEP 5/7: Tag Audit ===\n');
  const tags = await tagCall({ scan_id: scanId, required_tags: ['owner', 'environment', 'costcenter'] }, options);
  if (!tags.success) { console.error('TAG FAILED:', tags.output); process.exit(1); }
  console.log(`  Targets scanned:     ${tags.output.target_count}`);
  console.log(`  Compliant:           ${tags.output.compliant_count}`);
  console.log(`  Missing tag findings:${tags.output.missing_tag_findings}`);
  if (tags.output.findings?.length) {
    for (const f of tags.output.findings.slice(0, 5)) {
      console.log(`  - ${f.title}`);
    }
  }
  console.log();

  console.log('=== STEP 6/7: Waste Report ===\n');
  const waste = await wasteCall({ scan_id: scanId }, options);
  if (!waste.success) { console.error('WASTE FAILED:', waste.output); process.exit(1); }
  console.log(`  Findings:            ${waste.output.finding_count || waste.output.findings?.length || 0}`);
  if (waste.output.findings?.length) {
    for (const f of waste.output.findings) {
      console.log(`  - ${f.title}`);
    }
  }
  console.log();

  console.log('=== STEP 7/7: Executive Governance Report ===\n');
  const report = await reportCall({ scan_id: scanId }, options);
  if (!report.success) { console.error('REPORT FAILED:', report.output); process.exit(1); }
  console.log(report.output.markdown);
  console.log();

  console.log('GOVERNANCE PIPELINE COMPLETE — all 7 steps succeeded.');
}

run().catch(err => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});