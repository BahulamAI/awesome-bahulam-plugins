/**
 * Cost by Azure service, read from Cost Management.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure } from './lib.mjs';
import { recordSnapshot } from './snapshot.mjs';
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

    // Record what was read so the panel can show it with its provenance.
    // Best-effort by design: a lost snapshot costs a card, a failed tool
    // costs the answer.
    recordSnapshot(state, {
      tool: 'azure_cost_by_service',
      scope: `${config.subscription_id} · last ${days}d`,
      currency: resolvedCurrency,
      rows: services.map((item) => ({ dimension: 'service', label: item.name, amount: item.cost })),
    });

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
