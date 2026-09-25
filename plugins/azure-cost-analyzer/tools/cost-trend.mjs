/**
 * Daily cost trend, read from Cost Management.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure } from './lib.mjs';
import { lastNDays, normalizeDate, queryCost } from './azure.mjs';

export async function call(args = {}, { state, deps } = {}) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const days = Math.min(365, Math.max(1, Number(args.days) || 30));

  try {
    const result = await queryCost(config, {
      timeframe: 'Custom',
      timePeriod: lastNDays(days),
      granularity: 'Daily',
      deps,
    });

    const byDate = new Map();
    for (const row of result.rows) {
      const date = normalizeDate(result.pick(row, ['UsageDate', 'BillingMonth', 'Date']));
      if (!date) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + (Number(result.get(row, result.measure, 0)) || 0));
    }

    const round = (n) => Math.round(n * 100) / 100;
    const dailyCosts = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost: round(cost) }));

    const total = round(dailyCosts.reduce((sum, item) => sum + item.cost, 0));
    const resolvedCurrency = result.currency || config.currency;

    return {
      success: true,
      output: {
        daily_costs: dailyCosts,
        total,
        currency: resolvedCurrency,
        period_days: days,
        measure: result.measure,
      },
    };
  } catch (error) {
    return toolFailure(error, 'Could not read the cost trend');
  }
}
