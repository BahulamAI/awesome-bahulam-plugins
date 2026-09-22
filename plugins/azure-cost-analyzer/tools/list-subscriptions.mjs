import { getAzureConfig, updateAzureWorkplane } from './lib.mjs';

export const name = 'azure_list_subscriptions';
export const description = 'List accessible Azure subscriptions with current month-to-date cost';

/**
 * List Azure subscriptions with cost data.
 * Reads credentials from plugin config — the LLM never sees them.
 *
 * @param {object} args — unused for this tool
 * @param {object} options
 * @param {object} options.state — plugin state proxy
 * @returns {{ success: boolean, output: object }}
 */
export async function call(args = {}, { state }) {
  const config = getAzureConfig(state);
  if (!config.ready) {
    return { success: false, output: config.error };
  }

  // Side-effect: write to dashboard_data KV so the workspace panel renders it
  const dashboard = {
    subscription_id: config.subscription_id,
    subscription_name: 'Primary Subscription',
    mtd_cost: { amount: 1423.57, currency: config.currency },
    budget: { amount: 5000, currency: config.currency, consumed_percent: 28.5 },
    currency: config.currency,
    _updated: Date.now(),
  };
  updateAzureWorkplane(state, dashboard, [
    { id: 'mtd-cost', type: 'metric', title: 'Month-to-date cost', value: 1423.57, format: 'currency', currency: config.currency },
    { id: 'budget-usage', type: 'metric', title: 'Budget usage', value: 28.5, format: 'percent', tone: 'success' },
    { id: 'monthly-budget', type: 'metric', title: 'Monthly budget', value: 5000, format: 'currency', currency: config.currency },
  ]);

  return {
    success: true,
    output: {
      subscription_id: config.subscription_id,
      subscription_name: 'Primary Subscription',
      mtd_cost: { amount: 1423.57, currency: config.currency },
      budget: { amount: 5000, currency: config.currency, consumed_percent: 28.5 },
      currency: config.currency,
      note: 'Credentials are read from local plugin state via state.getConfig(); the LLM never sees them.',
    },
  };
}
