/**
 * Cost aggregated by a chosen dimension, read from Cost Management.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure } from './lib.mjs';
import { recordSnapshot } from './snapshot.mjs';
import { lastNDays, queryCost } from './azure.mjs';

/** Our dimension names mapped to Cost Management's. */
const DIMENSIONS = {
  region: { name: 'ResourceLocation', label: 'region' },
  resource_group: { name: 'ResourceGroupName', label: 'resource group' },
  resource_type: { name: 'ResourceType', label: 'resource type' },
  // Tags are not a Dimension in Cost Management; they are their own axis.
  tag: { name: 'TagKey', label: 'tag', isTag: true },
};

export async function call(args = {}, { state, deps } = {}) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const requested = String(args.dimension || 'region');
  const dimension = DIMENSIONS[requested];
  if (!dimension) {
    return {
      success: false,
      output: `Unsupported dimension "${requested}". Choose one of: ${Object.keys(DIMENSIONS).join(', ')}.`,
    };
  }
  const days = Math.min(365, Math.max(1, Number(args.days) || 30));

  try {
    const result = await queryCost(config, {
      timeframe: 'Custom',
      timePeriod: lastNDays(days),
      granularity: 'None',
      grouping: [dimension.isTag
        ? { type: 'TagKey', name: 'Tag' }
        : { type: 'Dimension', name: dimension.name }],
      deps,
    });

    const round = (n) => Math.round(n * 100) / 100;
    const values = result.rows
      .map((row) => {
        return {
          value: String(result.pick(row, [dimension.name, 'TagKey', 'Tag'], 'Unknown') || 'Unassigned'),
          cost: round(Number(result.get(row, result.measure, 0)) || 0),
        };
      })
      .filter((item) => item.cost !== 0)
      .sort((a, b) => b.cost - a.cost);

    const total = round(values.reduce((sum, item) => sum + item.cost, 0));
    const resolvedCurrency = result.currency || config.currency;

    // Record what was read so the panel can show it with its provenance.
    // Best-effort by design: a lost snapshot costs a card, a failed tool
    // costs the answer.
    recordSnapshot(state, {
      tool: 'azure_cost_by_dimension',
      scope: `${config.subscription_id} · last ${days}d by ${requested}`,
      currency: resolvedCurrency,
      rows: values.map((item) => ({ dimension: requested, label: item.value, amount: item.cost })),
    });

    return {
      success: true,
      output: {
        dimension: requested,
        values,
        total,
        currency: resolvedCurrency,
        period_days: days,
        measure: result.measure,
      },
    };
  } catch (error) {
    return toolFailure(error, `Could not read cost by ${dimension.label}`);
  }
}
