/**
 * Cost by resource type, with individual resources, read from Cost Management.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure } from './lib.mjs';
import { recordSnapshot } from './snapshot.mjs';
import { lastNDays, queryCost } from './azure.mjs';

/** A resource id's type segment, e.g. Microsoft.Web/sites. */
function typeOf(resourceId) {
  const match = String(resourceId ?? '').match(/\/providers\/([^/]+\/[^/]+)/i);
  return match ? match[1] : 'Unknown';
}

function nameOf(resourceId) {
  const parts = String(resourceId ?? '').split('/');
  return parts[parts.length - 1] || String(resourceId ?? '');
}

export async function call(args = {}, { state, deps } = {}) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const days = Math.min(365, Math.max(1, Number(args.days) || 30));
  const filterType = String(args.filter_type || '').trim().toLowerCase();

  try {
    const result = await queryCost(config, {
      timeframe: 'Custom',
      timePeriod: lastNDays(days),
      granularity: 'None',
      grouping: [
        { type: 'Dimension', name: 'ResourceId' },
        { type: 'Dimension', name: 'ResourceGroupName' },
        { type: 'Dimension', name: 'ResourceLocation' },
      ],
      deps,
    });

    const round = (n) => Math.round(n * 100) / 100;

    const resources = result.rows
      .map((row) => {
        const resourceId = String(result.get(row, 'ResourceId', '') ?? '');
        return {
          name: nameOf(resourceId),
          type: typeOf(resourceId),
          region: String(result.get(row, 'ResourceLocation', '') ?? ''),
          resource_group: String(result.get(row, 'ResourceGroupName', '') ?? ''),
          cost: round(Number(result.get(row, result.measure, 0)) || 0),
          resource_id: resourceId,
        };
      })
      .filter((item) => item.cost !== 0)
      .filter((item) => !filterType || item.type.toLowerCase().includes(filterType))
      .sort((a, b) => b.cost - a.cost);

    const byType = new Map();
    for (const resource of resources) {
      byType.set(resource.type, round((byType.get(resource.type) ?? 0) + resource.cost));
    }
    const types = [...byType.entries()]
      .map(([type, cost]) => ({ type, cost }))
      .sort((a, b) => b.cost - a.cost);

    const total = round(resources.reduce((sum, item) => sum + item.cost, 0));
    const resolvedCurrency = result.currency || config.currency;

    // Record what was read so the panel can show it with its provenance.
    // Best-effort by design: a lost snapshot costs a card, a failed tool
    // costs the answer.
    recordSnapshot(state, {
      tool: 'azure_resources_by_type',
      scope: `${config.subscription_id} · last ${days}d by resource`,
      currency: resolvedCurrency,
      rows: resources.slice(0, 200).map((item) => ({ dimension: 'resource', label: `${item.name} (${item.type})`, amount: item.cost })),
    });

    return {
      success: true,
      output: {
        period_days: days,
        currency: resolvedCurrency,
        types,
        resources: resources.slice(0, 200),
        resource_count: resources.length,
        total,
        measure: result.measure,
        ...(filterType ? { filter_type: args.filter_type } : {}),
      },
    };
  } catch (error) {
    return toolFailure(error, 'Could not read resources by type');
  }
}
