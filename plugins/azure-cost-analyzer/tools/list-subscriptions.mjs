/**
 * Accessible subscriptions with month-to-date cost for the configured one.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure } from './lib.mjs';
import { listSubscriptions, queryCost } from './azure.mjs';

export async function call(_args = {}, { state, deps } = {}) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  try {
    const subscriptions = await listSubscriptions(config, deps);

    // Month-to-date for the CONFIGURED subscription only. Querying every
    // subscription would be N throttled calls for data nobody asked for.
    let mtd = null;
    let mtdError = null;
    // Null until Azure tells us. Reporting the configured currency for a figure
    // that came from Azure is how INR gets labelled USD.
    let currency = null;
    try {
      const result = await queryCost(config, {
        timeframe: 'MonthToDate',
        granularity: 'None',
        deps,
      });
      const total = result.rows.reduce(
        (sum, row) => sum + (Number(result.get(row, result.measure, 0)) || 0),
        0,
      );
      currency = result.currency;
      mtd = Math.round(total * 100) / 100;
    } catch (costError) {
      // The subscription list is still useful when cost is unreadable; say why
      // rather than reporting a cost of zero.
      mtd = null;
      mtdError = costError.message;
    }

    return {
      success: true,
      output: {
        subscriptions: subscriptions.map((item) => ({
          ...item,
          configured: item.subscription_id === config.subscription_id,
          ...(item.subscription_id === config.subscription_id ? { month_to_date_cost: mtd } : {}),
        })),
        configured_subscription_id: config.subscription_id,
        month_to_date_cost: mtd,
        currency,
        ...(currency && config.currency && currency !== config.currency
          ? { currency_note: `Azure bills this subscription in ${currency}; plugin settings say ${config.currency}. No conversion is applied.` }
          : {}),
        ...(mtdError ? { cost_unavailable: mtdError } : {}),
      },
    };
  } catch (error) {
    return toolFailure(error, 'Could not list subscriptions');
  }
}
