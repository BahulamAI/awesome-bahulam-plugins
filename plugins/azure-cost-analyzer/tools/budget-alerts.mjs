/**
 * Consumption budgets and which exceed a threshold, read from Azure.
 *
 * @returns {{ success: boolean, output: object|string }}
 */
import { getAzureConfig, toolFailure } from './lib.mjs';
import { listBudgets } from './azure.mjs';

export async function call(args = {}, { state, deps } = {}) {
  const config = getAzureConfig(state);
  if (!config.ready) return { success: false, output: config.error };

  const threshold = Math.min(100, Math.max(1, Number(args.threshold_percent) || 80));

  try {
    const budgets = await listBudgets(config, deps);

    const round = (n) => Math.round(n * 100) / 100;
    const evaluated = budgets.map((budget) => {
      // A zero-amount budget has no meaningful percentage; say so rather than
      // dividing by zero and reporting Infinity.
      const consumed = budget.amount > 0 ? (budget.current_spend / budget.amount) * 100 : null;
      return {
        name: budget.name,
        amount: round(budget.amount),
        current_spend: round(budget.current_spend),
        consumed_percent: consumed === null ? null : Math.round(consumed * 10) / 10,
        time_grain: budget.time_grain,
        currency: budget.currency || config.currency,
        breached: consumed !== null && consumed >= threshold,
      };
    });

    const breached = evaluated.filter((budget) => budget.breached);
    const currency = evaluated[0]?.currency || config.currency;

    return {
      success: true,
      output: {
        threshold_percent: threshold,
        budgets: evaluated,
        breached: breached.map((b) => b.name),
        budget_count: evaluated.length,
        currency,
      },
    };
  } catch (error) {
    return toolFailure(error, 'Could not read budgets');
  }
}
