/**
 * Recording a tool result into the plugin's own SQLite state.
 *
 * Two declared tables rather than one per tool. Every tool here produces the
 * same shape — a set of labelled amounts, captured at a moment, for a scope, in
 * a currency — so a run and its rows generalise, and the panel can render any
 * of them without knowing which tool ran.
 *
 * `cost_runs` is the provenance half and is the reason this exists at all: a
 * figure on screen with no capture time, no scope and no currency is a number a
 * reader cannot check. The rows are worthless without it.
 *
 * MONEY IS INTEGER MINOR UNITS. Azure returns decimals; they are converted once,
 * here, so nothing downstream rounds twice and no two readers disagree about the
 * cent. `currency_exponent` travels with the amount because minor units are
 * meaningless without it — JPY has none, KWD has three.
 */

/** Currencies whose minor unit is not two digits. Everything else is two. */
const EXPONENTS = new Map([
  ['JPY', 0], ['KRW', 0], ['VND', 0], ['CLP', 0], ['ISK', 0], ['UGX', 0],
  ['BHD', 3], ['JOD', 3], ['KWD', 3], ['OMR', 3], ['TND', 3],
]);

export function currencyExponent(currency) {
  return EXPONENTS.get(String(currency || '').toUpperCase()) ?? 2;
}

export function toMinorUnits(amount, currency) {
  const factor = 10 ** currencyExponent(currency);
  // Round once, at the boundary, so the stored integer is the single truth.
  return Math.round((Number(amount) || 0) * factor);
}

/**
 * Write one run and its rows.
 *
 * Deliberately best-effort: a plugin whose database is unavailable must still
 * answer the agent's question. Losing the snapshot costs the panel a card;
 * failing the tool costs the user their answer, which is worse. The reason is
 * returned rather than thrown so a caller can report it if it wants to.
 *
 * @returns {{ recorded: true, runId: number|string } | { recorded: false, reason: string }}
 */
export function recordSnapshot(state, { tool, scope, currency, rows, note = null }) {
  if (!state || typeof state.query !== 'function') {
    return { recorded: false, reason: 'plugin state is unavailable' };
  }
  const exponent = currencyExponent(currency);
  const capturedAt = new Date().toISOString();

  try {
    state.query(
      `INSERT INTO cost_runs (captured_at, tool, scope, currency, currency_exponent, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [capturedAt, String(tool), String(scope ?? ''), String(currency ?? ''), exponent, note],
    );
    // `last_insert_rowid()` is scoped to this connection, and the plugin state
    // handle is one connection per plugin, so this cannot pick up another
    // plugin's insert.
    const runId = state.query('SELECT last_insert_rowid() AS id')?.[0]?.id;
    if (runId === undefined) return { recorded: false, reason: 'could not identify the recorded run' };

    for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
      state.query(
        `INSERT INTO cost_rows (run_id, position, dimension, label, amount_minor)
         VALUES (?, ?, ?, ?, ?)`,
        [
          runId,
          index,
          String(row.dimension ?? ''),
          String(row.label ?? ''),
          toMinorUnits(row.amount, currency),
        ],
      );
    }
    return { recorded: true, runId };
  } catch (error) {
    return { recorded: false, reason: error?.message ? String(error.message) : String(error) };
  }
}
