/**
 * Daily cost trend, read from Cost Management.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure, updateAzureWorkplane } from './lib.mjs';
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

    updateAzureWorkplane(
      state,
      { daily_costs: dailyCosts, total_trend_cost: total, currency: resolvedCurrency, period_days: days, _updated: Date.now() },
      [
        { id: 'cost-trend', type: 'line_chart', title: `Daily cost trend · ${days} days`,
          data: dailyCosts.map((item) => ({ label: item.date, value: item.cost })),
          format: 'currency', currency: resolvedCurrency },
      ],
    );

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
