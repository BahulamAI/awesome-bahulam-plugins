/**
 * Cost by Azure service, read from Cost Management.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure, updateAzureWorkplane } from './lib.mjs';
import { lastNDays, queryCost } from './azure.mjs';

export async function call(args = {}, { state, deps } = {}) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const days = Math.min(365, Math.max(1, Number(args.days) || 30));

  try {
    const result = await queryCost(config, {
      timeframe: 'Custom',
      timePeriod: lastNDays(days),
      granularity: 'None',
      grouping: [{ type: 'Dimension', name: 'ServiceName' }],
      deps,
    });

    const services = result.rows
      .map((row) => {
        return {
          name: String(result.pick(row, ['ServiceName', 'ServiceTier'], 'Unknown')),
          cost: Number(result.get(row, result.measure, 0)) || 0,
        };
      })
      .filter((item) => item.cost !== 0)
      .sort((a, b) => b.cost - a.cost);

    const total = services.reduce((sum, item) => sum + item.cost, 0);
    const resolvedCurrency = result.currency || config.currency;
    const round = (n) => Math.round(n * 100) / 100;

    updateAzureWorkplane(
      state,
      {
        services,
        total_by_service: round(total),
        period_days: days,
        currency: resolvedCurrency,
        _updated: Date.now(),
      },
      [
        { id: 'cost-by-service', type: 'bar_chart', title: `Cost by service · ${days} days`,
          data: services.slice(0, 20).map((item) => ({ label: item.name, value: round(item.cost) })),
          format: 'currency', currency: resolvedCurrency },
        { id: 'cost-by-service-table', type: 'table', title: 'Service detail',
          columns: ['Service', 'Cost'],
          rows: services.map((item) => [item.name, round(item.cost)]),
          format: { 1: 'currency' }, currency: resolvedCurrency },
      ],
    );

    return {
      success: true,
      output: {
        subscription_id: config.subscription_id,
        period_days: days,
        currency: resolvedCurrency,
        services: services.map((item) => ({ name: item.name, cost: round(item.cost) })),
        total: round(total),
        measure: result.measure,
      },
    };
  } catch (error) {
    return toolFailure(error, 'Could not read cost by service');
  }
}
