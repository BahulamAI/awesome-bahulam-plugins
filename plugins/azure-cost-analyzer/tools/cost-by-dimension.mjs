import { getAzureConfig, updateAzureWorkplane } from './lib.mjs';

export const name = 'azure_cost_by_dimension';
export const description = 'Get Azure costs aggregated by a chosen dimension (region, resource_group, tag, resource_type)';

/**
 * Aggregate costs by a chosen dimension for slice-and-dice analysis.
 *
 * @param {object} args
 * @param {('region'|'resource_group'|'tag'|'resource_type')} [args.dimension='region']
 * @param {number} [args.days=30]
 * @param {object} options
 * @param {object} options.state — plugin state proxy
 * @returns {{ success: boolean, output: object }}
 */
export async function call(args = {}, { state }) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const days = Math.min(90, Math.max(1, Number(args.days) || 30));
  const dimension = (args.dimension || 'region').trim();

  // Simulated dimension aggregates — these sum to ~$1,423.57
  const ALL = {
    region: [
      { value: 'eastus', cost: 585.00, pct: 41.1 },
      { value: 'westeurope', cost: 325.10, pct: 22.8 },
      { value: 'southeastasia', cost: 117.57, pct: 8.3 },
      { value: 'eastus2', cost: 105.00, pct: 7.4 },
      { value: 'northeurope', cost: 290.90, pct: 20.4 },
    ],
    resource_group: [
      { value: 'rg-production', cost: 865.00, pct: 60.8 },
      { value: 'rg-staging', cost: 195.00, pct: 13.7 },
      { value: 'rg-development', cost: 142.57, pct: 10.0 },
      { value: 'rg-shared-services', cost: 221.00, pct: 15.5 },
    ],
    tag: [
      { value: 'env:production', cost: 865.00, pct: 60.8 },
      { value: 'env:staging', cost: 195.00, pct: 13.7 },
      { value: 'env:development', cost: 142.57, pct: 10.0 },
      { value: 'team:platform', cost: 652.00, pct: 45.8 },
      { value: 'team:frontend', cost: 220.00, pct: 15.5 },
      { value: 'team:backend', cost: 375.00, pct: 26.3 },
    ],
    resource_type: [
      { value: 'App Service Plans', cost: 280.00, pct: 19.7 },
      { value: 'Web Apps', cost: 220.00, pct: 15.5 },
      { value: 'SQL Databases', cost: 325.00, pct: 22.8 },
      { value: 'Storage Accounts', cost: 125.00, pct: 8.8 },
      { value: 'Blob Containers', cost: 85.00, pct: 6.0 },
      { value: 'AKS Clusters', cost: 180.00, pct: 12.6 },
      { value: 'Virtual Machines', cost: 135.00, pct: 9.5 },
      { value: 'Azure Functions', cost: 72.57, pct: 5.1 },
    ],
  };

  const selected = ALL[dimension] || ALL.region;
  const total = selected.reduce((s, item) => s + item.cost, 0);

  // Side-effect: write ALL dimensions so the Slice & Dice tab can switch without re-querying
  const dashboard = {
    cost_by_dimension: ALL,
    currency: config.currency,
    period_days: days,
    _updated: Date.now(),
  };
  updateAzureWorkplane(state, dashboard, [
    { id: `cost-by-${dimension}`, type: 'bar_chart', title: `Cost by ${dimension.replace('_', ' ')} · ${days} days`, data: selected.map(item => ({ label: item.value, value: item.cost })), format: 'currency', currency: config.currency },
  ]);

  return {
    success: true,
    output: {
      dimension,
      values: selected,
      total,
      currency: config.currency,
      period_days: days,
    },
  };
}
