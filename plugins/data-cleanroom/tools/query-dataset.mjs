/**
 * query_dataset — read the ingested rows.
 *
 * The only way the agent sees actual data (the generated context_tools reach
 * the catalog, never the warehouse). SQL is allowed because the alternative —
 * an agent that can only read whole tables — makes the typed store pointless.
 *
 * Guarded rather than free: single statement, SELECT/WITH only, and the FROM
 * clause may name only THIS dataset's table. That keeps the tool from being
 * a way to DROP a table or read someone else's dataset.
 */

import { requireDataset } from './lib/catalog.mjs';
import { assertReadOnlySql, openWarehouse, quoteIdent, tableExists } from './lib/warehouse.mjs';

export const name = 'query_dataset';
export const description = 'Run a read-only SELECT against a loaded dataset table and return the rows';

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'query_dataset: plugin state unavailable' };

  const resolved = requireDataset(state, args.dataset_id, 'query_dataset');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const dataset = resolved.dataset;

  const sql = String(args.sql ?? '').trim();
  if (!sql) return { success: false, output: 'query_dataset: `sql` is required' };

  const guard = assertReadOnlySql(sql, [dataset.table_name]);
  if (!guard.ok) return { success: false, output: `query_dataset: ${guard.reason}` };

  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(args.limit) || DEFAULT_LIMIT));
  const params = Array.isArray(args.params) ? args.params : [];

  let db;
  try {
    db = await openWarehouse();
  } catch (err) {
    return { success: false, output: `query_dataset: ${err.message}` };
  }

  try {
    if (!tableExists(db, dataset.table_name)) {
      return {
        success: false,
        output: `query_dataset: warehouse table "${dataset.table_name}" is missing — reload dataset ${dataset.id}.`,
      };
    }

    // The row cap is applied by wrapping the query rather than by trusting the
    // caller's LIMIT, so a `SELECT *` cannot return a million rows.
    const wrapped = `SELECT * FROM (${sql.replace(/;+$/, '')}) LIMIT ?`;
    const rows = db.prepare(wrapped).all(...params, limit);

    const columns = rows.length ? Object.keys(rows[0]) : [];
    return {
      success: true,
      output: {
        dataset_id: Number(dataset.id),
        dataset_name: dataset.name,
        table_name: dataset.table_name,
        columns,
        row_count: rows.length,
        limited: rows.length >= limit,
        limit,
        rows,
        note: rows.length >= limit
          ? `capped at ${limit} rows — raise limit (max ${MAX_LIMIT}) or aggregate in SQL`
          : null,
      },
    };
  } catch (err) {
    return { success: false, output: `query_dataset: ${err.message}` };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

export { quoteIdent };
