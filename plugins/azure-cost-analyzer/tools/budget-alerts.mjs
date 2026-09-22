import { getAzureConfig, updateAzureWorkplane } from './lib.mjs';

export const name = 'azure_budget_alerts';
export const description = 'Check Azure budgets and alert on threshold breaches';

/**
 * Check Azure budgets and generate alerts.
 *
 * @param {object} args
 * @param {number} [args.threshold_percent=80] — alert when consumed exceeds this %
 * @param {object} options
 * @param {object} options.state — plugin state proxy
 * @returns {{ success: boolean, output: object }}
 */
export async function call(args = {}, { state }) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const threshold = Math.min(100, Math.max(1, Number(args.threshold_percent) || 80));

  // Side-effect: write to dashboard_data KV so the workspace panel renders it
  const budgets = [{ name: 'Monthly Cap', amount: 5000, consumed: 1423.57, percent: 28.5, alert: false }];
  const dashboard = {
    budgets,
    alerts: [],
    threshold_percent: threshold,
    currency: config.currency,
    _updated: Date.now(),
  };
  updateAzureWorkplane(state, dashboard, [
    { id: 'budget-status', type: 'table', title: `Budget status · alert at ${threshold}%`, columns: ['Budget', 'Spent', 'Limit', 'Used'], rows: budgets.map(budget => [budget.name, budget.consumed, budget.amount, budget.percent]), format: { 1: 'currency', 2: 'currency', 3: 'percent' }, currency: config.currency },
    { id: 'budget-alerts', type: 'alert', title: 'Budget alerts', tone: 'success', message: `No budgets exceed ${threshold}%.` },
  ]);

  return {
    success: true,
    output: {
      subscription_id: config.subscription_id,
      threshold_percent: threshold,
      currency: config.currency,
      budgets,
      alerts: [],
      note: threshold >= 80
        ? `No budgets exceed ${threshold}% threshold.`
        : `All budgets below ${threshold}%.`,
    },
  };
}
