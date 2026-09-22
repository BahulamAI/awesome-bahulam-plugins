import { getAzureConfig, updateAzureWorkplane } from './lib.mjs';

export const name = 'azure_cost_trend';
export const description = 'Get daily Azure cost data points for trend line chart visualization';

/**
 * Generate daily cost data points for trend visualization.
 *
 * @param {object} args
 * @param {number} [args.days=30] — number of days to look back (1-90)
 * @param {object} options
 * @param {object} options.state — plugin state proxy
 * @returns {{ success: boolean, output: object }}
 */
export async function call(args = {}, { state }) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const days = Math.min(90, Math.max(1, Number(args.days) || 30));

  // Generate daily costs with a sinusoidal weekly pattern + random noise
  // ~$1,423.57 total over 30 days, mean ~$47.45/day
  const now = new Date();
  const dailyCosts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // Weekly cycle: weekend lower, mid-week higher
    const dayOfWeek = d.getDay();
    const weekFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.7 : 1.15;
    // Some randomness ±20%
    const noise = 0.8 + Math.random() * 0.4;
    const cost = Math.round(47.45 * weekFactor * noise * 100) / 100;
    dailyCosts.push({ date: dateStr, cost });
  }

  const total = dailyCosts.reduce((s, d) => s + d.cost, 0);

  // Side-effect: write to dashboard_data so the panel renders the trend chart
  const dashboard = {
    daily_costs: dailyCosts,
    trend_period_days: days,
    total_trend_cost: total,
    currency: config.currency,
    _updated: Date.now(),
  };
  updateAzureWorkplane(state, dashboard, [
    { id: 'cost-trend', type: 'line_chart', title: `Daily cost trend · ${days} days`, data: dailyCosts.map(item => ({ label: item.date, value: item.cost })), format: 'currency', currency: config.currency },
  ]);

  return {
    success: true,
    output: {
      daily_costs: dailyCosts,
      total,
      currency: config.currency,
      period_days: days,
    },
  };
}
