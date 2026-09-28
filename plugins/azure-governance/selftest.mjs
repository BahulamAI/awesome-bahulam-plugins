/**
 * Offline smoke test for azure-governance.
 *
 * Run: node plugins/azure-governance/selftest.mjs
 */

import { call as scanCall } from './tools/azure-inventory-scan.mjs';
import { call as resourceGroupCall } from './tools/azure-resource-group-report.mjs';
import { call as costCall } from './tools/azure-cost-report.mjs';
import { call as accessCall } from './tools/azure-access-matrix.mjs';
import { call as securityCall } from './tools/azure-security-findings.mjs';
import { call as tagCall } from './tools/azure-tag-audit.mjs';
import { call as wasteCall } from './tools/azure-waste-report.mjs';
import { call as reportCall } from './tools/azure-governance-report.mjs';
import { collectCostDetails } from './tools/azure-enhancements.mjs';
import { collectAzureCli } from './tools/azure-cli.mjs';

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
}

const rows = [];
const fakeState = {
  append(stream, payload) {
    const row = { id: rows.length + 1, stream, payload, created_at: new Date(0).toISOString() };
    rows.push(row);
    return row.id;
  },
  list(stream, { limit = 50, order = 'desc' } = {}) {
    const filtered = rows.filter(row => row.stream === stream);
    const ordered = order === 'asc' ? filtered : [...filtered].reverse();
    return ordered.slice(0, limit);
  },
};
const options = { state: Promise.resolve(fakeState) };

const generatedCostDetails = await collectCostDetails({
  include_cost_details: true,
  cost_start_date: '2026-09-01',
  cost_end_date: '2026-09-02',
}, ['sub-cost-details'], {
  tokenProvider: async () => 'test-token',
  fetch: async url => {
    if (url.includes('generateCostDetailsReport')) {
      return new Response(JSON.stringify({ manifest: { blobs: [{ blobLink: 'https://cost.example/details.csv' }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('SubscriptionId,ResourceGroup,ResourceId,ServiceName,CostInUsd,CostInBillingCurrency,BillingCurrency,Tags\nsub-cost-details,"rg,quoted",/subscriptions/sub-cost-details/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/st1,Storage,9.75,8.5,EUR,"{""owner"":""finops""}"\n', { status: 200 });
  },
});
check('Cost Details live ingestion parses quoted CSV and CostInUsd', generatedCostDetails.rows.length === 1 && generatedCostDetails.rows[0].resource_group === 'rg,quoted' && generatedCostDetails.rows[0].cost === 9.75 && generatedCostDetails.rows[0].source_currency === 'EUR' && generatedCostDetails.rows[0].tags.owner === 'finops');

const scan = await scanCall({
  name: 'demo estate',
  tenant_id: 'tenant-001',
  subscriptions: [{ id: 'sub-001', name: 'Production' }],
  resource_groups: [{ name: 'rg-prod-app', subscription_id: 'sub-001', tags: { environment: 'prod' } }],
  resources: [
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Network/publicIPAddresses/pip-web',
      name: 'pip-web',
      type: 'Microsoft.Network/publicIPAddresses',
      properties: { ipAddress: '20.1.2.3' },
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Network/networkSecurityGroups/nsg-web',
      name: 'nsg-web',
      type: 'Microsoft.Network/networkSecurityGroups',
      security_rules: [
        { source: '0.0.0.0/0', port: '3389', access: 'Allow' },
        { properties: { sourceAddressPrefix: 'Internet', destinationPortRange: '22', access: 'Allow', direction: 'Inbound' } },
        { properties: { sourceAddressPrefix: 'Internet', destinationPortRange: '22', access: 'Allow', direction: 'Outbound' } },
      ],
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Compute/disks/orphan',
      name: 'orphan',
      type: 'Microsoft.Compute/disks',
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stsafe',
      name: 'stsafe',
      type: 'Microsoft.Storage/storageAccounts',
      properties: { allowBlobPublicAccess: 'false', minimumTlsVersion: 'TLS1_0', supportsHttpsTrafficOnly: false, allowSharedKeyAccess: true, requireInfrastructureEncryption: false },
      tags: { Owner: 'platform', Environment: 'prod', CostCenter: 'cc-001' },
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.KeyVault/vaults/kv-safe',
      name: 'kv-safe',
      type: 'Microsoft.KeyVault/vaults',
      properties: { publicNetworkAccess: 'disabled' },
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Network/privateEndpoints/pe-storage',
      name: 'pe-storage',
      type: 'Microsoft.Network/privateEndpoints',
      properties: {
        privateLinkServiceConnections: [{
          properties: {
            privateLinkServiceId: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stsafe',
            privateLinkServiceConnectionState: { status: 'Approved' },
          },
        }],
      },
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Sql/servers/sql-prod',
      name: 'sql-prod',
      type: 'Microsoft.Sql/servers',
      properties: { publicNetworkAccess: 'Enabled', minimalTlsVersion: '1.0' },
    },
    {
      id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Sql/servers/sql-prod/firewallRules/allow-all',
      name: 'allow-all',
      type: 'Microsoft.Sql/servers/firewallRules',
      properties: { startIpAddress: '0.0.0.0', endIpAddress: '255.255.255.255' },
    },
  ],
  role_assignments: [
    { id: 'ra-owner', principal: 'alice@example.com', principal_id: 'alice-001', principal_type: 'User', role: 'Owner', scope: '/subscriptions/sub-001', principal_last_sign_in_at: '2025-01-01T00:00:00Z' },
    { principal: 'deleted-principal', principalType: 'Unknown', role: 'Reader', scope: '/subscriptions/sub-001/resourceGroups/rg-prod-app' },
    { id: 'ra-group', principal: 'Cloud Admins', principal_id: 'group-admins', principal_type: 'Group', role: 'Platform Access Manager', role_type: 'CustomRole', role_permissions: [{ actions: ['Microsoft.Authorization/roleAssignments/write'] }], scope: '/providers/Microsoft.Management/managementGroups/mg-root' },
    { id: 'ra-identity', principal: 'orders-api', principal_id: 'mi-orders', principal_type: 'ServicePrincipal', service_principal_type: 'ManagedIdentity', principal_account_enabled: false, role: 'Contributor', scope: '/subscriptions/sub-001' },
    { id: 'ra-resource', principal: 'auditor@example.com', principal_id: 'auditor-001', principal_type: 'User', role: 'Reader', scope: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stsafe' },
  ],
  role_definitions: [
    { id: '/subscriptions/sub-001/providers/Microsoft.Authorization/roleDefinitions/owner', name: 'Owner', role_type: 'BuiltInRole', permissions: [{ actions: ['*'] }] },
  ],
  principals: [
    { id: 'alice-001', display_name: 'alice@example.com', principal_type: 'User', account_enabled: true },
    { id: 'auditor-001', display_name: 'auditor@example.com', principal_type: 'User', account_enabled: true },
    { id: 'mi-orders', display_name: 'orders-api', principal_type: 'servicePrincipal', account_enabled: true },
  ],
  group_memberships: [
    { group_id: 'group-admins', group_name: 'Cloud Admins', member_id: 'bob-001', member_name: 'bob@example.com', member_type: 'User', account_enabled: true, last_sign_in_at: '2026-09-20T00:00:00Z' },
  ],
  costs: [
    { subscription_id: 'sub-001', resource_group: 'rg-prod-app', service: 'Virtual Machines', meter: 'D4s v5', sku: 'Standard_D4s_v5', cost: 1200.50, usage_start: '2026-09-01', tags: { CostCenter: 'cc-001' } },
    { subscription_id: 'sub-001', resource_group: 'rg-prod-app', resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Compute/disks/orphan', service: 'Storage', meter: 'Premium SSD', sku: 'P10', cost: 99.50, usage_start: '2026-09-02' },
    { subscription_id: 'sub-001', resource_group: 'rg-prod-app', service: 'Bandwidth', pretaxCost: 10, usage_start: '2026-09-03' },
  ],
  benefit_recommendations: [
    { id: 'benefit-1', kind: 'savings_plan', subscription_id: 'sub-001', term: 'P1Y', hourly_commitment_usd: 2.5, estimated_savings_usd: 525.75 },
  ],
  monitor_metrics: [
    { resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Sql/servers/sql-prod', resource_type: 'Microsoft.Sql/servers', average_cpu_percent: 8, metrics: { cpu_percent: { average: 8 } } },
  ],
  pim_assignments: [
    { id: 'pim-eligible', assignment_type: 'eligible', principal_id: 'alice-001', role_definition_id: '/subscriptions/sub-001/providers/Microsoft.Authorization/roleDefinitions/owner', scope: '/subscriptions/sub-001', start_date_time: '2026-09-01T00:00:00Z', end_date_time: '2026-10-01T00:00:00Z' },
  ],
  service_principal_credentials: [
    { principal_id: 'mi-orders', principal_name: 'orders-api', credential_id: 'cred-old', credential_type: 'password', end_date_time: '2026-09-01T00:00:00Z' },
  ],
  federated_identity_credentials: [
    { id: 'fic-1', principal_id: 'mi-orders', name: 'github-main', issuer: 'https://token.actions.githubusercontent.com', subject: 'repo:org/app:ref:refs/heads/main' },
  ],
  sign_in_activity: [
    { principal_id: 'auditor-001', principal_type: 'user', last_sign_in_at: '2026-09-24T00:00:00Z' },
  ],
  policy_states: [
    { resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stsafe', compliance_state: 'NonCompliant', policy_definition_name: 'Require secure transfer' },
    { resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.KeyVault/vaults/kv-safe', compliance_state: 'Compliant', policy_definition_name: 'Key Vault public access disabled', policy_assignment_id: '/subscriptions/sub-001/providers/Microsoft.Authorization/policyAssignments/security-baseline' },
  ],
  policy_assignments: [
    { id: '/subscriptions/sub-001/providers/Microsoft.Authorization/policyAssignments/security-baseline', name: 'Security baseline', scope: '/subscriptions/sub-001', enforcement_mode: 'DoNotEnforce' },
  ],
  diagnostic_settings: [
    { id: 'diag-storage', name: 'send-to-law', resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stsafe', workspace_id: '/subscriptions/sub-001/resourceGroups/rg-monitor/providers/Microsoft.OperationalInsights/workspaces/law', logs: [{ enabled: true }] },
  ],
  subscription_diagnostic_settings: [],
  resource_locks: [],
  security_assessments: [
    { resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Compute/virtualMachines/vm1', name: 'Install endpoint protection', severity: 'High', status_code: 'Unhealthy' },
  ],
  secure_scores: [
    { id: 'secure-score-sub-001', subscription_id: 'sub-001', current: 40, maximum: 100, percentage: 0.4 },
  ],
  regulatory_compliance: [
    { id: 'reg-1', subscription_id: 'sub-001', standard: 'Azure-CIS', state: 'Failed', passed: 8, failed: 2 },
  ],
  advisor_recommendations: [
    { resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Compute/virtualMachines/vm1', category: 'Cost', impact: 'Medium', problem: 'Right-size underutilized VM', annual_savings_amount: 240, savings_currency: 'USD' },
    { resource_id: '/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Network/networkSecurityGroups/nsg-web', category: 'Security', impact: 'High', problem: 'Restrict management ports' },
  ],
}, options);
check('azure_inventory_scan succeeds', scan.success);
check('azure_inventory_scan counts resources', scan.output.resource_count === 8);
const resourceGroups = await resourceGroupCall({ format: 'markdown' }, options);
check('azure_resource_group_report succeeds', resourceGroups.success);
check('azure_resource_group_report lists stored groups once', resourceGroups.output.resource_group_count === 1 && resourceGroups.output.resource_groups[0].name === 'rg-prod-app');
check('azure_resource_group_report counts resources', resourceGroups.output.resource_groups[0].resource_count === 8);
check('azure_resource_group_report resolves subscription names', resourceGroups.output.resource_groups[0].subscription_name === 'Production');
check('azure_resource_group_report renders markdown', resourceGroups.output.markdown.includes('| Production | rg-prod-app |'));

const cost = await costCall({ group_by: 'resource_group' }, options);
check('azure_cost_report succeeds', cost.success);
check('azure_cost_report totals cost', cost.output.total_cost === 1310);
check('azure_cost_report labels total as dollars', cost.output.currency === 'USD' && cost.output.total_cost_display === '$1,310.00');
check('azure_cost_report includes alternate cost fields in untagged spend', cost.output.untagged_cost === 109.5 && cost.output.untagged_cost_display === '$109.50');
check('azure_cost_report includes daily costs', cost.output.daily_costs.length === 3);
check('azure_cost_report includes month-end forecast', cost.output.forecast?.month_end_forecast > 0);
check('azure_cost_report labels forecast as dollars', cost.output.forecast?.month_end_forecast_display?.startsWith('$'));
check('azure_cost_report detects idle resources with observed dollar cost', cost.output.optimization.idle_expensive_resources.some(row => row.name === 'orphan' && row.observed_cost_display === '$99.50'));
check('azure_cost_report includes Advisor right-sizing recommendations', cost.output.optimization.rightsizing_recommendations.some(row => row.source === 'azure_advisor' && row.estimated_annual_savings_display === '$240.00'));
check('azure_cost_report includes native quoted savings in dollars', cost.output.optimization.native_commitment_recommendations[0].estimated_savings_display === '$525.75');
check('azure_cost_report exposes Azure Monitor metric evidence', cost.output.optimization.monitor_metric_resources.length === 1);
const meterCost = await costCall({ group_by: 'meter' }, options);
check('azure_cost_report groups by meter', meterCost.success && meterCost.output.groups.some(row => row.name === 'D4s v5' && row.cost === 1200.5));
const tagCost = await costCall({ group_by: 'tag', tag_key: 'CostCenter' }, options);
check('azure_cost_report groups by a selected tag key', tagCost.success && tagCost.output.groups.some(row => row.name === 'cc-001' && row.cost === 1200.5));
const commitmentCost = await costCall({ min_commitment_days: 1, min_commitment_cost_usd: 100 }, options);
check('azure_cost_report screens sustained compute for commitments', commitmentCost.success && commitmentCost.output.optimization.commitment_candidates.some(row => row.service === 'Virtual Machines' && row.commitment_options.includes('savings_plan')));

const access = await accessCall({ as_of: '2026-09-25T00:00:00Z', format: 'all' }, options);
check('azure_access_matrix succeeds', access.success);
check('azure_access_matrix detects built-in and custom privileged access', access.output.privileged_count === 4 && access.output.custom_privileged_count === 2);
check('azure_access_matrix classifies subscription and management group scopes', access.output.broad_scope_count === 4 && access.output.scope_reports.some(row => row.scope_level === 'management_group'));
check('azure_access_matrix classifies resource scopes', access.output.scope_reports.some(row => row.scope_level === 'resource' && row.scope.endsWith('/stsafe')));
check('azure_access_matrix detects principalType unknown', access.output.unknown_principal_count === 1);
check('azure_access_matrix expands effective group access', access.output.effective_group_access_count === 1 && access.output.group_based_access[0].principal === 'bob@example.com');
check('azure_access_matrix detects inactive managed identities with broad access', access.output.inactive_principal_count === 1 && access.output.workload_broad_access.some(row => row.principal_type === 'managed_identity'));
check('azure_access_matrix detects stale principals', access.output.stale_principal_count === 1 && access.output.stale_principals[0].principal === 'alice@example.com');
check('azure_access_matrix builds principal-centric reports', access.output.principal_reports.some(row => row.principal === 'bob@example.com' && row.group_based_assignment_count === 1 && row.risk_flags.includes('privileged')));
check('azure_access_matrix exports CSV and Markdown', access.output.csv.startsWith('principal,principal_id') && access.output.markdown.includes('# Azure RBAC Access Review'));
check('azure_access_matrix reports eligible time-bound PIM access', access.output.eligible_pim_assignment_count === 1 && access.output.expiring_pim_assignment_count === 1);
check('azure_access_matrix finds expired application credentials', access.output.expired_credential_count === 1);
check('azure_access_matrix inventories federated identities', access.output.federated_identity_count === 1);
check('azure_access_matrix consumes native sign-in activity', access.output.assignments.some(row => row.principal_id === 'auditor-001' && row.last_activity_at === '2026-09-24T00:00:00Z'));
const bobAccess = await accessCall({ principal: 'bob@example.com', as_of: '2026-09-25T00:00:00Z' }, options);
check('azure_access_matrix filters principal effective access', bobAccess.success && bobAccess.output.assignment_count === 0 && bobAccess.output.effective_assignment_count === 1);

const security = await securityCall({}, options);
check('azure_security_findings succeeds', security.success);
check('azure_security_findings detects public exposure and posture findings', security.output.findings.some(row => row.control === 'network.open_management_port'));
check('azure_security_findings detects broad database firewall rules', security.output.findings.some(row => row.control === 'database.broad_firewall' && row.severity === 'high'));
check('azure_security_findings detects missing diagnostics', security.output.findings.some(row => row.control === 'monitoring.missing_diagnostics' && row.target.includes('sql-prod')));
check('azure_security_findings detects missing production locks', security.output.findings.some(row => row.control === 'governance.missing_production_lock'));
check('azure_security_findings detects disabled policy enforcement', security.output.findings.some(row => row.control === 'policy.enforcement_disabled'));
check('azure_security_findings detects missing private endpoints', security.output.findings.some(row => row.control === 'network.missing_private_endpoint' && row.target.includes('sql-prod')));
check('azure_security_findings recognizes approved private endpoints', !security.output.findings.some(row => row.control === 'network.missing_private_endpoint' && row.target.includes('stsafe')));
check('azure_security_findings calculates policy compliance scores', security.output.summary.compliance_score_percent === 50 && security.output.compliance.subscriptions[0].score_percent === 50 && security.output.compliance.resource_groups[0].score_percent === 50);
check('azure_security_findings scores policy assignments', security.output.compliance.assignments.some(row => row.policy_assignment_name === 'Security baseline' && row.score_percent === 100));
check('azure_security_findings summarizes Defender posture', security.output.defender.unhealthy === 1 && security.output.defender.severity.high === 1);
check('azure_security_findings reports Defender secure score', security.output.summary.defender_secure_score_percent === 40 && security.output.findings.some(row => row.control === 'defender.low_secure_score'));
check('azure_security_findings reports regulatory failures', security.output.summary.regulatory_failed_control_count === 2 && security.output.findings.some(row => row.control === 'defender.regulatory_compliance_failure'));
check('azure_security_findings audits activity-log export', security.output.findings.some(row => row.control === 'monitoring.missing_activity_log_export'));
check('azure_security_findings audits TLS, encryption, and local auth', ['storage.minimum_tls', 'storage.infrastructure_encryption_disabled', 'storage.local_auth_enabled', 'sql.minimum_tls'].every(control => security.output.findings.some(row => row.control === control)));
const securityWithoutMissing = await securityCall({ evaluate_missing_controls: false }, options);
check('azure_security_findings can disable inferred missing controls', securityWithoutMissing.success && !securityWithoutMissing.output.findings.some(row => ['monitoring.missing_diagnostics', 'monitoring.missing_activity_log_export', 'governance.missing_production_lock', 'network.missing_private_endpoint'].includes(row.control)));

const tags = await tagCall({ required_tags: ['owner', 'environment', 'costCenter'] }, options);
check('azure_tag_audit succeeds', tags.success);
check('azure_tag_audit finds missing tags', tags.output.missing_tag_findings > 0);
check('azure_tag_audit treats tag keys case-insensitively', !tags.output.findings.some(row => row.target.includes('stsafe')));

const waste = await wasteCall({}, options);
check('azure_waste_report succeeds', waste.success);
check('azure_waste_report finds unattached disk', waste.output.findings.some(row => row.title.includes('disk')));
check('azure_waste_report includes Advisor cost recommendations in dollars', waste.output.findings.some(row => row.title.includes('Advisor cost') && row.title.includes('$240.00')));

const report = await reportCall({}, options);
check('azure_governance_report succeeds', report.success);
check('azure_governance_report returns markdown', report.output.markdown.includes('Azure Governance Report'));
check('azure_governance_report reports total cost in dollars', report.output.markdown.includes('Total observed cost: $1,310.00'));
check('azure_governance_report summarizes identity posture', report.output.summary.privileged_assignments === 3 && report.output.summary.group_role_assignments === 1 && report.output.summary.group_memberships === 1);
check('azure_governance_report summarizes compliance evidence', report.output.summary.policy_assignments === 1 && report.output.summary.disabled_policy_assignments === 1 && report.output.summary.diagnostic_settings === 1);
check('azure_governance_report summarizes completed enhancements', report.output.summary.pim_assignments === 1 && report.output.summary.expired_service_principal_credentials === 1 && report.output.summary.defender_secure_score_percent === 40 && report.output.summary.native_estimated_savings_usd === 525.75);

const azCalls = [];
let cliCostFetchAttempts = 0;
const cliStateRows = [];
const cliState = {
  append(stream, payload) {
    const row = { id: cliStateRows.length + 1, stream, payload, created_at: new Date(0).toISOString() };
    cliStateRows.push(row);
    return row.id;
  },
  list(stream, { limit = 50, order = 'desc' } = {}) {
    const filtered = cliStateRows.filter(row => row.stream === stream);
    const ordered = order === 'asc' ? filtered : [...filtered].reverse();
    return ordered.slice(0, limit);
  },
};
const cliOptions = {
  state: Promise.resolve(cliState),
  sleep: async () => {},
  fetch: async (url, request) => {
    cliCostFetchAttempts++;
    check('azure_inventory_scan calls the Cost Management query endpoint', url.includes('/providers/Microsoft.CostManagement/query?'));
    check('azure_inventory_scan sends a bearer token', request.headers.authorization === 'Bearer cli-test-token');
    const body = JSON.parse(request.body);
    check('azure_inventory_scan limits CLI cost grouping to two dimensions', body.dataset?.grouping?.length === 2);
    check('azure_inventory_scan requests daily CLI costs by default', body.dataset?.granularity === 'Daily');
    check('azure_inventory_scan requests CLI costs in dollars', body.dataset?.aggregation?.totalCost?.name === 'CostUSD');
    if (cliCostFetchAttempts === 1) {
      return new Response('throttled', { status: 429, headers: { 'retry-after': '1' } });
    }
    return new Response(JSON.stringify({
      properties: {
        columns: [
          { name: 'PreTaxCost', type: 'Number' },
          { name: 'ResourceGroup', type: 'String' },
          { name: 'ResourceId', type: 'String' },
          { name: 'Currency', type: 'String' },
        ],
        rows: [
          [30.25, 'rg-cli', '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Compute/virtualMachines/vm1', 'USD'],
          [12, 'rg-cli', '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Storage/storageAccounts/st1', 'USD'],
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
  exec: async argv => {
    azCalls.push(argv);
    if (argv[0] === 'graph' && argv[1] === 'query') {
      const query = String(argv[argv.indexOf('--graph-query') + 1] || '').toLowerCase();
      if (query.startsWith('resources ')) {
        if (!argv.includes('--skip-token')) {
          return JSON.stringify({ data: [{ id: '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Compute/virtualMachines/vm1', name: 'vm1', type: 'Microsoft.Compute/virtualMachines', subscriptionId: 'sub-cli', resourceGroup: 'rg-cli', location: 'eastus', tags: { Environment: 'prod' }, properties: { provisioningState: 'Succeeded' } }], skip_token: 'next-resource-page' });
        }
        return JSON.stringify({ data: [] });
      }
      if (query.includes('roledefinitions')) {
        return JSON.stringify({ data: [{ id: '/subscriptions/sub-cli/providers/Microsoft.Authorization/roleDefinitions/reader', subscriptionId: 'sub-cli', roleName: 'Reader', roleType: 'BuiltInRole', permissions: [{ actions: ['*/read'] }], assignableScopes: ['/subscriptions/sub-cli'] }] });
      }
      if (query.includes('policyassignments')) {
        return JSON.stringify({ data: [{ id: '/subscriptions/sub-cli/providers/Microsoft.Authorization/policyAssignments/baseline', name: 'baseline', subscriptionId: 'sub-cli', displayName: 'CLI baseline', scope: '/subscriptions/sub-cli', policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/baseline', enforcementMode: 'Default' }] });
      }
      if (query.includes('policystates')) {
        return JSON.stringify({ data: [{ id: 'cli-policy-state', subscriptionId: 'sub-cli', resourceId: '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Compute/virtualMachines/vm1', resourceType: 'Microsoft.Compute/virtualMachines', complianceState: 'NonCompliant', policyAssignmentId: '/subscriptions/sub-cli/providers/Microsoft.Authorization/policyAssignments/baseline', policyDefinitionName: 'CLI VM baseline' }] });
      }
      if (query.includes("microsoft.security/assessments")) {
        return JSON.stringify({ data: [{ id: 'cli-assessment', subscriptionId: 'sub-cli', resourceId: '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Compute/virtualMachines/vm1', displayName: 'Protect CLI VM', severity: 'High', statusCode: 'Unhealthy' }] });
      }
      if (query.includes("microsoft.security/securescores'")) {
        return JSON.stringify({ data: [{ id: 'cli-secure-score', name: 'ascScore', subscriptionId: 'sub-cli', current: 55, maximum: 100, percentage: 0.55, weight: 1 }] });
      }
      if (query.includes('regulatorycompliance')) {
        return JSON.stringify({ data: [{ id: 'cli-regulatory', subscriptionId: 'sub-cli', standard: 'Azure-CIS', state: 'Failed', passedControls: 9, failedControls: 1 }] });
      }
      if (query.includes('advisorresources')) {
        return JSON.stringify({ data: [{ id: 'cli-advisor', subscriptionId: 'sub-cli', resourceId: '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Compute/virtualMachines/vm1', category: 'Cost', impact: 'Medium', problem: 'Right-size CLI VM', solution: 'Resize the VM', annualSavingsAmount: 120, savingsCurrency: 'USD' }] });
      }
      throw new Error(`unexpected az graph query: ${query}`);
    }
    const command = argv.slice(0, -3).join(' ');
    if (command === 'account list --all') {
      return JSON.stringify([{ id: 'sub-cli', name: 'CLI Production', tenantId: 'tenant-cli', state: 'Enabled', isDefault: true }]);
    }
    if (command === 'account tenant list') return JSON.stringify([{ tenantId: 'tenant-cli' }]);
    if (command === 'account get-access-token --resource https://management.azure.com/') return JSON.stringify({ accessToken: 'cli-test-token' });
    if (command === 'group list --subscription sub-cli') {
      return JSON.stringify([{ id: '/subscriptions/sub-cli/resourceGroups/rg-cli', name: 'rg-cli', location: 'eastus', tags: { Owner: 'ops' } }]);
    }
    if (command === 'resource list --subscription sub-cli') {
      return JSON.stringify([{ id: '/subscriptions/sub-cli/resourceGroups/rg-cli/providers/Microsoft.Compute/virtualMachines/vm1', name: 'vm1', type: 'Microsoft.Compute/virtualMachines', resourceGroup: 'rg-cli', location: 'eastus', tags: { Environment: 'prod' } }]);
    }
    if (command === 'role assignment list --all --subscription sub-cli') {
      return JSON.stringify([{ principalName: 'ops@example.com', principalType: 'User', roleDefinitionName: 'Reader', scope: '/subscriptions/sub-cli/resourceGroups/rg-cli' }]);
    }
    throw new Error(`unexpected az command: ${command}`);
  },
};
const cliScan = await scanCall({
  name: 'cli estate',
  collect_from: 'azure_cli',
  include_costs: true,
  cost_start_date: '2026-09-01',
  cost_end_date: '2026-09-23',
}, cliOptions);
check('azure_inventory_scan supports Azure CLI collection', cliScan.success);
check('azure_inventory_scan collects CLI subscriptions', cliScan.output.subscription_count === 1);
check('azure_inventory_scan collects CLI resource groups', cliScan.output.resource_group_count === 1);
check('azure_inventory_scan collects CLI resources', cliScan.output.resource_count === 1);
check('azure_inventory_scan collects CLI role assignments', cliScan.output.role_assignment_count === 1);
check('azure_inventory_scan collects CLI Resource Graph role definitions', cliScan.output.role_definition_count === 1);
check('azure_inventory_scan collects CLI Resource Graph Policy evidence', cliScan.output.policy_assignment_count === 1);
check('azure_inventory_scan collects CLI Resource Graph Defender evidence', cliScan.output.secure_score_count === 1 && cliScan.output.regulatory_compliance_count === 1);
check('azure_inventory_scan collects optional CLI costs', cliScan.output.total_cost === 42.25);
check('azure_inventory_scan retries a throttled Cost Management query once', cliCostFetchAttempts === 2);
check('azure_inventory_scan labels CLI total as dollars', cliScan.output.total_cost_display === '$42.25' && cliScan.output.currency === 'USD');
check('azure_inventory_scan records CLI Resource Graph metadata', cliScan.output.collector.source === 'azure_cli' && cliScan.output.collector.engine === 'azure_cli_resource_graph' && cliScan.output.collector.resource_graph_succeeded && cliScan.output.collector.warnings.length === 0);
check('azure_inventory_scan prefers Resource Graph over az resource list', !azCalls.some(argv => argv[0] === 'resource' && argv[1] === 'list'));
check('azure_inventory_scan scopes and pages CLI Resource Graph queries', azCalls.filter(argv => argv[0] === 'graph').every(argv => argv.includes('--subscriptions') && argv.includes('sub-cli') && argv.includes('--first')) && azCalls.some(argv => argv[0] === 'graph' && argv.includes('--skip-token')));
check('azure_inventory_scan uses read-only az commands', azCalls.every(argv => !['create', 'update', 'delete', 'set'].includes(argv[1])));
const nestedCost = await costCall({ group_by: 'resource_group' }, cliOptions);
check('azure_cost_report groups costs by resource group', nestedCost.success && nestedCost.output.resource_groups.length === 1);
check('azure_cost_report includes resources inside resource group', nestedCost.output.resource_groups[0].resources.length === 2);
check('azure_cost_report resolves resource names from inventory', nestedCost.output.resource_groups[0].resources.some(row => row.name === 'vm1' && row.cost === 30.25));

const cliFallbackCalls = [];
const cliFallback = await collectAzureCli({ subscription_ids: ['sub-fallback'] }, {
  exec: async argv => {
    cliFallbackCalls.push(argv);
    if (argv[0] === 'account' && argv[1] === 'list') return JSON.stringify([{ id: 'sub-fallback', name: 'Fallback', tenantId: 'tenant-fallback', state: 'Enabled' }]);
    if (argv[0] === 'account' && argv[1] === 'tenant') return JSON.stringify([{ tenantId: 'tenant-fallback' }]);
    if (argv[0] === 'graph') throw new Error("'graph' is misspelled or not recognized by the system");
    if (argv[0] === 'group') return JSON.stringify([{ id: '/subscriptions/sub-fallback/resourceGroups/rg-fallback', name: 'rg-fallback' }]);
    if (argv[0] === 'resource') return JSON.stringify([{ id: '/subscriptions/sub-fallback/resourceGroups/rg-fallback/providers/Microsoft.Storage/storageAccounts/stfallback', name: 'stfallback', type: 'Microsoft.Storage/storageAccounts', resourceGroup: 'rg-fallback' }]);
    if (argv[0] === 'role') return JSON.stringify([]);
    throw new Error(`unexpected fallback az command: ${argv.join(' ')}`);
  },
});
check('azure_inventory_scan falls back when the Resource Graph extension is unavailable', cliFallback.resources.length === 1 && cliFallback.collector.engine === 'azure_cli' && !cliFallback.collector.resource_graph_succeeded && cliFallback.collector.warnings.some(row => row.includes('falling back to az resource list')) && cliFallbackCalls.some(argv => argv[0] === 'resource'));

const sdkQueries = [];
const graphCalls = [];
const sdkStateRows = [];
const sdkState = {
  append(stream, payload) {
    const row = { id: sdkStateRows.length + 1, stream, payload, created_at: new Date(0).toISOString() };
    sdkStateRows.push(row);
    return row.id;
  },
  list(stream, { limit = 50, order = 'desc' } = {}) {
    const filtered = sdkStateRows.filter(row => row.stream === stream);
    const ordered = order === 'asc' ? filtered : [...filtered].reverse();
    return ordered.slice(0, limit);
  },
};
const sdkOptions = {
  state: Promise.resolve(sdkState),
  principalResolver: async ids => ids.map(id => id === 'group-sdk'
    ? { id, displayName: 'SDK Readers', '@odata.type': '#microsoft.graph.group' }
    : { id, displayName: 'SDK Workload', '@odata.type': '#microsoft.graph.servicePrincipal', accountEnabled: true }),
  benefitRecommendationsResolver: async () => [
    {
      id: 'native-saving-sdk',
      kind: 'savings_plan',
      properties: { subscriptionId: 'sub-sdk', term: 'P1Y', recommendationDetails: { commitmentAmount: 1.25, savingsAmount: 300, savingsPercentage: 12 } },
    },
    {
      id: 'native-reservation-sdk',
      kind: 'reservation',
      properties: { subscriptionId: 'sub-sdk', term: 'P3Y', netSavings: { currency: 'USD', value: 125 }, recommendedQuantity: 1 },
    },
  ],
  monitorMetricsResolver: async resources => resources.map(resource => ({
    resource_id: resource.id,
    resource_type: resource.type,
    average_cpu_percent: 9,
    metrics: { 'Percentage CPU': { average: 9, samples: 24 } },
  })),
  pimResolver: async () => [{
    id: 'pim-sdk',
    assignment_type: 'eligible',
    principalId: 'principal-sdk',
    roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/reader',
    scope: '/subscriptions/sub-sdk',
    startDateTime: '2026-09-01T00:00:00Z',
    endDateTime: '2026-10-01T00:00:00Z',
  }],
  identityDetailsResolver: async () => ({
    service_principal_credentials: [{ principal_id: 'principal-sdk', credential_id: 'sdk-secret', credential_type: 'password', end_date_time: '2026-09-28T00:00:00Z' }],
    federated_identity_credentials: [{ id: 'sdk-fic', principal_id: 'principal-sdk', name: 'sdk-workload', issuer: 'https://issuer.example' }],
    sign_in_activity: [{ principal_id: 'principal-sdk', principal_type: 'service_principal', last_sign_in_at: '2026-09-24T00:00:00Z' }],
  }),
  azureSdk: {
    credential: { getToken: async () => ({ token: 'test-token' }) },
  },
  fetch: async url => {
    graphCalls.push(url);
    return {
      ok: true,
      async json() {
        return {
          value: [{
            id: 'member-sdk',
            displayName: 'SDK User',
            '@odata.type': '#microsoft.graph.user',
            accountEnabled: true,
          }],
        };
      },
    };
  },
  armGet: async url => {
    if (url.includes('/providers/Microsoft.Insights/diagnosticSettings')) {
      return {
        value: [{
          id: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Storage/storageAccounts/stsdk/providers/Microsoft.Insights/diagnosticSettings/send-to-law',
          name: 'send-to-law',
          properties: {
            workspaceId: '/subscriptions/sub-sdk/resourceGroups/rg-monitor/providers/Microsoft.OperationalInsights/workspaces/law',
            logs: [{ enabled: true }],
          },
        }],
      };
    }
    if (url.includes('/providers/Microsoft.Authorization/locks')) {
      return {
        value: [{
          id: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Authorization/locks/protect',
          name: 'protect',
          properties: { level: 'CanNotDelete' },
        }],
      };
    }
    throw new Error(`unexpected ARM governance URL: ${url}`);
  },
  resourceGraphClient: {
    async resources(request) {
      sdkQueries.push(request);
      const text = request.query.toLowerCase();
      if (text.includes("microsoft.resources/subscriptions/resourcegroups")) {
        return {
          data: [{
            id: '/subscriptions/sub-sdk/resourceGroups/rg-sdk',
            name: 'rg-sdk',
            subscriptionId: 'sub-sdk',
            location: 'eastus2',
            tags: { Owner: 'cloud' },
          }],
        };
      }
      if (text.includes("microsoft.resources/subscriptions'")) {
        return { data: [{ id: 'sub-sdk', subscriptionId: 'sub-sdk', name: 'SDK Production', tenantId: 'tenant-sdk', state: 'Enabled' }] };
      }
      if (text.includes('authorizationresources') && text.includes('roledefinitions')) {
        return {
          data: [{
            id: '/providers/Microsoft.Authorization/roleDefinitions/reader',
            name: 'reader',
            roleName: 'Reader',
            roleType: 'BuiltInRole',
            permissions: [{ actions: ['*/read'], notActions: [] }],
            assignableScopes: ['/'],
          }],
        };
      }
      if (text.includes('authorizationresources')) {
        return {
          data: [
            {
              id: '/subscriptions/sub-sdk/providers/Microsoft.Authorization/roleAssignments/ra1',
              subscriptionId: 'sub-sdk',
              scope: '/subscriptions/sub-sdk',
              principalId: 'principal-sdk',
              principalType: 'ServicePrincipal',
              roleDefinitionId: '/subscriptions/sub-sdk/providers/Microsoft.Authorization/roleDefinitions/reader',
            },
            {
              id: '/subscriptions/sub-sdk/providers/Microsoft.Authorization/roleAssignments/ra2',
              subscriptionId: 'sub-sdk',
              scope: '/subscriptions/sub-sdk/resourceGroups/rg-sdk',
              principalId: 'group-sdk',
              principalType: 'Group',
              roleDefinitionId: '/subscriptions/sub-sdk/providers/Microsoft.Authorization/roleDefinitions/reader',
            },
          ],
        };
      }
      if (text.includes('policyresources') && text.includes("microsoft.authorization/policyassignments")) {
        check('azure_inventory_scan requests policy assignments at parent scopes', request.options?.authorizationScopeFilter === 'AtScopeAndAbove');
        return {
          data: [{
            id: '/subscriptions/sub-sdk/providers/Microsoft.Authorization/policyAssignments/security-baseline',
            name: 'security-baseline',
            subscriptionId: 'sub-sdk',
            scope: '/subscriptions/sub-sdk',
            displayName: 'Security baseline',
            policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/baseline',
            enforcementMode: 'Default',
          }],
        };
      }
      if (text.includes('policyresources')) {
        return {
          data: [{
            id: '/policyStates/latest/sub-sdk/policy1',
            subscriptionId: 'sub-sdk',
            resourceId: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Storage/storageAccounts/stsdk',
            complianceState: 'NonCompliant',
            policyDefinitionName: 'Storage accounts should restrict network access',
          }],
        };
      }
      if (text.includes('securityresources')) {
        return {
          data: [{
            id: '/subscriptions/sub-sdk/providers/Microsoft.Security/assessments/a1',
            subscriptionId: 'sub-sdk',
            resourceId: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Storage/storageAccounts/stsdk',
            displayName: 'Storage accounts should use private link',
            severity: 'Medium',
            statusCode: 'Unhealthy',
          }],
        };
      }
      if (text.includes('advisorresources')) {
        return {
          data: [{
            id: '/subscriptions/sub-sdk/providers/Microsoft.Advisor/recommendations/r1',
            subscriptionId: 'sub-sdk',
            resourceId: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Compute/virtualMachines/vm2',
            category: 'Cost',
            impact: 'High',
            problem: 'Shutdown or resize underutilized virtual machine',
            annualSavingsAmount: 480,
            savingsCurrency: 'USD',
          }],
        };
      }
      if (text.includes('resources')) {
        return {
          data: [{
            id: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Storage/storageAccounts/stsdk',
            name: 'stsdk',
            type: 'Microsoft.Storage/storageAccounts',
            subscriptionId: 'sub-sdk',
            resourceGroup: 'rg-sdk',
            location: 'eastus2',
            tags: { Environment: 'prod' },
            properties: { allowBlobPublicAccess: false },
          }],
        };
      }
      return { data: [] };
    },
  },
  costManagementClient: {
    query: {
      async usage(scope, body) {
        check('azure_inventory_scan calls SDK Cost Management with subscription scope', scope === 'subscriptions/sub-sdk');
        check('azure_inventory_scan requests daily SDK costs', body.dataset?.granularity === 'Daily');
        check('azure_inventory_scan limits SDK cost grouping to two dimensions', body.dataset?.grouping?.length === 2);
        check('azure_inventory_scan selects requested SDK cost dimensions', body.dataset?.grouping?.map(row => row.name).join(',') === 'ServiceName,Meter');
        check('azure_inventory_scan requests SDK costs in dollars', body.dataset?.aggregation?.totalCost?.name === 'CostUSD');
        return {
          columns: [
            { name: 'PreTaxCost', type: 'Number' },
            { name: 'UsageDate', type: 'Number' },
            { name: 'ResourceGroup', type: 'String' },
            { name: 'ResourceId', type: 'String' },
            { name: 'ServiceName', type: 'String' },
            { name: 'ResourceLocation', type: 'String' },
            { name: 'Currency', type: 'String' },
          ],
          rows: [
            [10, 20260901, 'rg-sdk', '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Storage/storageAccounts/stsdk', 'Storage', 'eastus2', 'USD'],
            [20, 20260902, 'rg-sdk', '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Compute/virtualMachines/vm2', 'Virtual Machines', 'eastus2', 'USD'],
          ],
        };
      },
    },
  },
};
const sdkScan = await scanCall({
  name: 'sdk estate',
  collect_from: 'azure_sdk',
  include_costs: true,
  include_principals: true,
  include_group_memberships: true,
  include_pim: true,
  include_identity_details: true,
  include_benefit_recommendations: true,
  include_monitor_metrics: true,
  include_governance_details: true,
  cost_dimensions: ['service', 'meter'],
  subscription_ids: ['sub-sdk'],
  management_group_ids: ['mg-root'],
}, sdkOptions);
check('azure_inventory_scan supports Azure SDK Resource Graph collection', sdkScan.success);
check('azure_inventory_scan collects SDK subscriptions', sdkScan.output.subscription_count === 1);
check('azure_inventory_scan collects SDK resource groups', sdkScan.output.resource_group_count === 1);
check('azure_inventory_scan collects SDK resources', sdkScan.output.resource_count === 1);
check('azure_inventory_scan collects SDK role assignments', sdkScan.output.role_assignment_count === 2);
check('azure_inventory_scan collects SDK role definitions', sdkScan.output.role_definition_count === 1);
check('azure_inventory_scan resolves SDK principals', sdkScan.output.principal_count === 3 && sdkScan.output.collector.principal_enrichment_succeeded);
check('azure_inventory_scan resolves SDK group memberships', sdkScan.output.group_membership_count === 1 && sdkScan.output.collector.group_membership_enrichment_succeeded);
check('azure_inventory_scan reads transitive group members from Microsoft Graph', graphCalls.length === 1 && graphCalls[0].includes('/groups/group-sdk/transitiveMembers'));
check('azure_inventory_scan collects SDK policy assignments', sdkScan.output.policy_assignment_count === 1);
check('azure_inventory_scan collects SDK diagnostic settings', sdkScan.output.diagnostic_setting_count === 1);
check('azure_inventory_scan collects SDK resource locks', sdkScan.output.resource_lock_count === 1);
check('azure_inventory_scan collects SDK PIM and identity lifecycle evidence', sdkScan.output.pim_assignment_count === 1 && sdkScan.output.service_principal_credential_count === 1);
check('azure_inventory_scan collects Defender secure score and regulatory rows', sdkScan.output.secure_score_count === 1 && sdkScan.output.regulatory_compliance_count === 1);
check('azure_inventory_scan collects optional SDK costs', sdkScan.output.total_cost === 30);
check('azure_inventory_scan labels SDK total as dollars', sdkScan.output.total_cost_display === '$30.00' && sdkScan.output.currency === 'USD');
check('azure_inventory_scan records SDK collector metadata', sdkScan.output.collector.source === 'azure_sdk' && sdkScan.output.collector.engine === 'resource_graph');
check('azure_inventory_scan forwards Resource Graph scopes', sdkQueries.every(request => request.subscriptions?.[0] === 'sub-sdk' && request.managementGroups?.[0] === 'mg-root'));
const sdkSecurity = await securityCall({}, sdkOptions);
check('azure_security_findings consumes SDK policy and Defender rows', sdkSecurity.success && sdkSecurity.output.summary.non_compliant_policy_state_count === 1 && sdkSecurity.output.defender.unhealthy === 1);
check('azure_security_findings consumes SDK governance detail coverage', sdkSecurity.success && sdkSecurity.output.coverage.diagnostic_settings.complete && sdkSecurity.output.coverage.resource_locks.complete);
const sdkWaste = await wasteCall({}, sdkOptions);
check('azure_waste_report consumes SDK Advisor cost rows', sdkWaste.success && sdkWaste.output.finding_count === 1);
const sdkAccess = await accessCall({}, sdkOptions);
check('azure_access_matrix consumes enriched role and principal names', sdkAccess.success && sdkAccess.output.broad_scopes.some(row => row.principal === 'SDK Workload' && row.role === 'Reader'));
check('azure_access_matrix expands SDK group memberships', sdkAccess.success && sdkAccess.output.group_based_access.some(row => row.principal === 'SDK User' && row.via_group === 'SDK Readers'));
check('azure_access_matrix consumes SDK PIM, credential, federation, and sign-in evidence', sdkAccess.success && sdkAccess.output.eligible_pim_assignment_count === 1 && sdkAccess.output.expiring_credential_count === 1 && sdkAccess.output.federated_identity_count === 1 && sdkAccess.output.assignments.some(row => row.principal_id === 'principal-sdk' && row.last_activity_at === '2026-09-24T00:00:00Z'));
const sdkCost = await costCall({}, sdkOptions);
check('azure_cost_report consumes native SDK benefits and Monitor metrics', sdkCost.success && sdkCost.output.optimization.native_commitment_recommendations.length === 2 && sdkCost.output.optimization.native_commitment_recommendations.some(row => row.estimated_savings_usd === 300 && row.hourly_commitment_usd === 1.25) && sdkCost.output.optimization.native_commitment_recommendations.some(row => row.estimated_savings_usd === 125) && sdkCost.output.optimization.monitor_metric_resources.length === 1);
const sdkReport = await reportCall({}, sdkOptions);
check('azure_governance_report summarizes SDK posture rows', sdkReport.success && sdkReport.output.summary.non_compliant_policy_states === 1 && sdkReport.output.summary.advisor_recommendations === 1);

const costDetailsScan = await scanCall({
  name: 'sdk detailed costs',
  collect_from: 'azure_sdk',
  include_cost_details: true,
  subscription_ids: ['sub-sdk'],
}, {
  ...sdkOptions,
  costDetailsResolver: async () => [{
    SubscriptionId: 'sub-sdk',
    ResourceGroup: 'rg-sdk',
    ResourceId: '/subscriptions/sub-sdk/resourceGroups/rg-sdk/providers/Microsoft.Storage/storageAccounts/stsdk',
    ServiceName: 'Storage',
    MeterName: 'Hot LRS Data Stored',
    ProductName: 'Storage',
    Date: '2026-09-20',
    CostInUsd: 18.75,
    CostInBillingCurrency: 17,
    BillingCurrency: 'EUR',
    Tags: '{"owner":"cloud"}',
  }],
});
check('azure_inventory_scan ingests full Cost Details rows in dollars', costDetailsScan.success && costDetailsScan.output.total_cost === 18.75 && costDetailsScan.output.total_cost_display === '$18.75');

console.log(failures === 0 ? '\nALL AZURE-GOVERNANCE SELFTESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
