import { getAzureConfig, updateAzureWorkplane } from './lib.mjs';

export const name = 'azure_resources_by_type';
export const description = 'Get Azure cost breakdown by resource type with individual resource details (region, resource group, tags)';

/**
 * Simulated resource data grouped by resource type.
 *
 * @param {object} args
 * @param {number} [args.days=30] — lookback period (1-90)
 * @param {string} [args.filter_type] — optional filter to one resource type
 * @param {object} options
 * @param {object} options.state — plugin state proxy
 * @returns {{ success: boolean, output: object }}
 */
export async function call(args = {}, { state }) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const days = Math.min(90, Math.max(1, Number(args.days) || 30));
  const filterType = (args.filter_type || '').trim();

  const RESOURCES = [
    { name: 'app-plan-prod-01', type: 'App Service Plans', region: 'eastus', resource_group: 'rg-production', cost: 150.00, tags: { env: 'production', team: 'platform' } },
    { name: 'app-plan-stg-01', type: 'App Service Plans', region: 'westeurope', resource_group: 'rg-staging', cost: 85.00, tags: { env: 'staging', team: 'platform' } },
    { name: 'app-plan-dev-01', type: 'App Service Plans', region: 'eastus', resource_group: 'rg-development', cost: 45.00, tags: { env: 'development', team: 'platform' } },
    { name: 'webapp-prod-01', type: 'Web Apps', region: 'eastus', resource_group: 'rg-production', cost: 120.00, tags: { env: 'production', team: 'frontend' } },
    { name: 'webapp-stg-01', type: 'Web Apps', region: 'westeurope', resource_group: 'rg-staging', cost: 65.00, tags: { env: 'staging', team: 'frontend' } },
    { name: 'webapp-dev-01', type: 'Web Apps', region: 'southeastasia', resource_group: 'rg-development', cost: 35.00, tags: { env: 'development', team: 'frontend' } },
    { name: 'sql-prod-01', type: 'SQL Databases', region: 'eastus', resource_group: 'rg-production', cost: 200.00, tags: { env: 'production', team: 'backend' } },
    { name: 'sql-prod-dr-01', type: 'SQL Databases', region: 'westeurope', resource_group: 'rg-production', cost: 125.00, tags: { env: 'production', team: 'backend', dr: 'active' } },
    { name: 'stg-prod-01', type: 'Storage Accounts', region: 'eastus2', resource_group: 'rg-production', cost: 80.00, tags: { env: 'production', team: 'platform' } },
    { name: 'stg-stg-01', type: 'Storage Accounts', region: 'westeurope', resource_group: 'rg-staging', cost: 45.00, tags: { env: 'staging', team: 'platform' } },
    { name: 'blob-prod-assets', type: 'Blob Containers', region: 'eastus', resource_group: 'rg-production', cost: 60.00, tags: { env: 'production', team: 'frontend', tier: 'hot' } },
    { name: 'blob-prod-archive', type: 'Blob Containers', region: 'eastus2', resource_group: 'rg-production', cost: 25.00, tags: { env: 'production', team: 'platform', tier: 'cool' } },
    { name: 'aks-prod-01', type: 'AKS Clusters', region: 'eastus', resource_group: 'rg-production', cost: 180.00, tags: { env: 'production', team: 'platform' } },
    { name: 'vm-prod-web-01', type: 'Virtual Machines', region: 'eastus', resource_group: 'rg-production', cost: 95.00, tags: { env: 'production', team: 'frontend', os: 'linux' } },
    { name: 'vm-dev-01', type: 'Virtual Machines', region: 'southeastasia', resource_group: 'rg-development', cost: 40.00, tags: { env: 'development', team: 'platform', os: 'linux' } },
    { name: 'func-prod-payments', type: 'Azure Functions', region: 'westeurope', resource_group: 'rg-production', cost: 50.00, tags: { env: 'production', team: 'backend' } },
    { name: 'func-dev-webhook', type: 'Azure Functions', region: 'eastus', resource_group: 'rg-development', cost: 22.57, tags: { env: 'development', team: 'backend' } },
  ];

  const filtered = filterType ? RESOURCES.filter(r => r.type === filterType) : RESOURCES;

  // Group by type
  const groups = {};
  for (const r of filtered) {
    if (!groups[r.type]) groups[r.type] = { type: r.type, resources: [], total: 0 };
    groups[r.type].resources.push(r);
    groups[r.type].total += r.cost;
  }

  const resourceTypes = Object.values(groups).sort((a, b) => b.total - a.total);
  const total = resourceTypes.reduce((s, g) => s + g.total, 0);

  // Side-effect: write to dashboard_data so the panel renders it
  const dashboard = {
    resource_types: resourceTypes,
    total_by_resource_type: total,
    currency: config.currency,
    period_days: days,
    _updated: Date.now(),
  };
  updateAzureWorkplane(state, dashboard, [
    { id: 'resources-by-type', type: 'bar_chart', title: `Cost by resource type · ${days} days`, data: resourceTypes.map(group => ({ label: group.type, value: group.total })), format: 'currency', currency: config.currency },
    { id: 'resource-detail', type: 'table', title: 'Resource types', columns: ['Type', 'Resources', 'Cost'], rows: resourceTypes.map(group => [group.type, group.resources.length, group.total]), format: { 2: 'currency' }, currency: config.currency },
  ]);

  return {
    success: true,
    output: {
      resource_types: resourceTypes,
      total,
      currency: config.currency,
      period_days: days,
    },
  };
}
