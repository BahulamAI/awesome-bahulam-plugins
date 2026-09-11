/**
 * profile_dataset — compute the data-quality report.
 *
 * The verification half of the product. Every number is produced by a query
 * against the warehouse, which is what makes this a report rather than an
 * opinion: the model may summarise it, but it cannot invent it.
 *
 * Findings replace the previous set instead of accumulating, because a
 * finding describes the CURRENT data.
 */

import { logEvent, readColumns, replaceIssues, requireDataset, saveReport, setStatus, touchDataset } from './lib/catalog.mjs';
import { detectCandidateKeys, profileTable, summarizeProfile } from './lib/profile.mjs';
import { openWarehouse, tableExists } from './lib/warehouse.mjs';

export const name = 'profile_dataset';
export const description = 'Compute the data-quality report for a loaded dataset: nulls, duplicates, keys, outliers, findings';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'profile_dataset: plugin state unavailable' };

  const resolved = requireDataset(state, args.dataset_id, 'profile_dataset');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const dataset = resolved.dataset;

  const columns = readColumns(state, Number(dataset.id));
  if (!columns.length) {
    return { success: false, output: `profile_dataset: dataset ${dataset.id} has no recorded schema — load it first.` };
  }

  const fullScan = args.full_scan !== false;

  let db;
  try {
    db = await openWarehouse();
  } catch (err) {
    return { success: false, output: `profile_dataset: ${err.message}` };
  }

  try {
    if (!tableExists(db, dataset.table_name)) {
      return {
        success: false,
        output: `profile_dataset: warehouse table "${dataset.table_name}" does not exist — reload the dataset.`,
      };
    }

    const profile = profileTable(
      db,
      dataset.table_name,
      columns.map(c => ({ column_name: c.column_name, selected_type: c.selected_type })),
      { fullScan },
    );
    profile.candidate_keys = detectCandidateKeys(profile);
    profile.dataset_id = Number(dataset.id);
    profile.dataset_name = dataset.name;
    profile.table_name = dataset.table_name;

    const summary = summarizeProfile(profile);

    // The load_run the profile belongs to — the newest completed one.
    const lastRun = state.query(
      "SELECT * FROM load_runs WHERE dataset_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1",
      [Number(dataset.id)],
    )[0];
    const loadRunId = lastRun ? Number(lastRun.id) : 0;

    if (loadRunId) {
      replaceIssues(state, Number(dataset.id), loadRunId, profile.issues);
      saveReport(state, {
        dataset_id: Number(dataset.id),
        load_run_id: loadRunId,
        profile,
        summary,
      });
    }

    const now = new Date().toISOString();
    touchDataset(state, Number(dataset.id), { status: 'profiled' });
    setStatus(state, {
      active_dataset: dataset.name,
      dataset_id: Number(dataset.id),
      rows: profile.row_count,
      findings: profile.issues.length,
      updated_at: now,
    });
    logEvent(state, {
      event: 'profiled',
      dataset_id: Number(dataset.id),
      dataset: dataset.name,
      findings: profile.issues.length,
      at: now,
    });

    return {
      success: true,
      output: {
        dataset_id: Number(dataset.id),
        dataset_name: dataset.name,
        load_run_id: loadRunId || null,
        persisted: Boolean(loadRunId),
        summary,
        row_count: profile.row_count,
        column_count: profile.column_count,
        duplicate_rows: profile.duplicate_rows,
        candidate_keys: profile.candidate_keys,
        findings_by_severity: {
          high: profile.issues.filter(i => i.severity === 'high').length,
          medium: profile.issues.filter(i => i.severity === 'medium').length,
          low: profile.issues.filter(i => i.severity === 'low').length,
        },
        issues: profile.issues,
        columns: profile.columns.map(c => ({
          column_name: c.column_name,
          selected_type: c.selected_type,
          null_rate: c.null_rate,
          distinct_count: c.distinct_count,
          distinct_ratio: c.distinct_ratio,
          min_value: c.min_value,
          max_value: c.max_value,
          mean_value: c.mean_value,
          outlier_count: c.outlier_count,
          is_constant: c.is_constant,
        })),
      },
    };
  } catch (err) {
    return { success: false, output: `profile_dataset: ${err.message}` };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}
