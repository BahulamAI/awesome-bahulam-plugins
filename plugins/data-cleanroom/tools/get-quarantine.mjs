/**
 * get_quarantine — show the rows that were refused.
 *
 * The honesty tool. A loader that silently skips bad rows is worse than one
 * that fails, because the user cannot tell the difference between "my file
 * had 1000 rows" and "my table has 940". Every rejected row keeps its raw
 * text and the physical line it came from, so it can be fixed at source.
 */

import { requireDataset } from './lib/catalog.mjs';
import { openWarehouse, tableExists } from './lib/warehouse.mjs';

export const name = 'get_quarantine';
export const description = 'List rows that could not be loaded, with their source line and the reason each was rejected';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

function safeParse(text) {
  try { return JSON.parse(text); } catch { return []; }
}

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'get_quarantine: plugin state unavailable' };

  const resolved = requireDataset(state, args.dataset_id, 'get_quarantine');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const dataset = resolved.dataset;

  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(args.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(args.offset) || 0);

  let db;
  try {
    db = await openWarehouse();
  } catch (err) {
    return { success: false, output: `get_quarantine: ${err.message}` };
  }

  try {
    const table = dataset.quarantine_table_name;
    if (!tableExists(db, table)) {
      return {
        success: true,
        output: {
          dataset_id: Number(dataset.id),
          rejected_count: 0,
          rows: [],
          note: 'no quarantine table — this dataset has never had a rejected row',
        },
      };
    }

    const filters = ['1 = 1'];
    const params = [];
    if (args.load_run_id !== undefined && args.load_run_id !== null && args.load_run_id !== '') {
      const runId = Number(args.load_run_id);
      if (!Number.isInteger(runId) || runId < 1) {
        return { success: false, output: 'get_quarantine: `load_run_id` must be a positive integer' };
      }
      filters.push('load_run_id = ?');
      params.push(runId);
    }

    const where = filters.join(' AND ');
    const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`).get(...params).n || 0);
    const rows = db.prepare(
      `SELECT * FROM "${table}" WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);

    // The reasons are grouped as well as listed: the useful signal is usually
    // "37 rows had a bad date", not 37 individual complaints.
    const byReason = new Map();
    for (const row of rows) {
      for (const error of safeParse(row.errors_json)) {
        const key = `${error.column ?? '(row)'}: ${error.reason}`;
        byReason.set(key, (byReason.get(key) || 0) + 1);
      }
    }

    return {
      success: true,
      output: {
        dataset_id: Number(dataset.id),
        dataset_name: dataset.name,
        rejected_count: total,
        returned: rows.length,
        offset,
        limit,
        reasons: [...byReason.entries()].map(([reason, count]) => ({ reason, count })),
        rows: rows.map(row => ({
          id: Number(row.id),
          load_run_id: row.load_run_id === null ? null : Number(row.load_run_id),
          source_line: row.source_line === null ? null : Number(row.source_line),
          raw_record: row.raw_record,
          errors: safeParse(row.errors_json),
          created_at: row.created_at,
        })),
      },
    };
  } catch (err) {
    return { success: false, output: `get_quarantine: ${err.message}` };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}
