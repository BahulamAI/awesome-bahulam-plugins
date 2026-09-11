/**
 * load_dataset — probe, infer, coerce and load a messy file into the warehouse.
 *
 * This is the tool the plugin exists for. It is deterministic, idempotent,
 * and it never silently drops a row: anything that will not coerce is written
 * to the dataset's quarantine table with its physical source line and the
 * reason, so "where did my 40 rows go?" always has an answer.
 *
 * It writes TWO places, on purpose:
 *   - the catalog (declared state tables) — what this dataset IS
 *   - the warehouse (this plugin's own SQLite file) — the rows themselves
 * If a load fails halfway, the catalog records the failed run rather than
 * pretending it never happened.
 */

import {
  currentTransformVersion, finishLoadRun, insertColumns, insertSource, insertTransforms,
  logEvent, readDataset, setStatus, slugify, startLoadRun, touchDataset,
} from './lib/catalog.mjs';
import { coerceValue, schemaHash } from './lib/types.mjs';
import {
  createDatasetTable, createQuarantineTable, dropDatasetTable, insertRows,
  openWarehouse, quarantineTableNameFor, tableNameFor,
} from './lib/warehouse.mjs';
import { readAndInspect } from './probe-file.mjs';
import { inferSchema } from './preview-schema.mjs';

export const name = 'load_dataset';
export const description = 'Load a messy file into a typed, queryable warehouse table, quarantining rows that will not coerce';

/** Rows are written in batches so a huge file cannot blow the statement cache. */
export const BATCH_SIZE = 5000;

function parseDelimiterArg(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).replace('\\t', '\t');
}

/**
 * Coerce one record against the resolved columns.
 * Returns either a loadable row or a quarantine payload — never throws, and
 * never returns a partially coerced row, because a row with one bad cell is
 * a rejected row and not nine tenths of a good one.
 */
export function coerceRecord(record, columns, opts = {}) {
  if (!record.fields || record.fields.length !== columns.length) {
    return {
      ok: false,
      errors: [{
        column: null,
        reason: `expected ${columns.length} field(s), found ${record.fields ? record.fields.length : 0}`,
      }],
    };
  }

  const values = [];
  const errors = [];
  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];
    const override = (opts.overrides || {})[column.column_name] || {};
    const result = coerceValue(record.fields[i], column.selected_type, {
      nullTokens: opts.nullTokens,
      ...override,
    });
    if (!result.ok) {
      errors.push({ column: column.column_name, reason: result.reason });
      values.push(null);
      continue;
    }
    values.push(result.value);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, sourceLine: record.line, values };
}

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'load_dataset: plugin state unavailable' };

  const filePath = String(args.path ?? '').trim();
  const datasetName = String(args.name ?? '').trim();
  if (!filePath) return { success: false, output: 'load_dataset: `path` is required' };
  if (!datasetName) return { success: false, output: 'load_dataset: `name` is required' };

  // ── 1. Read and inspect ──────────────────────────────────────────────
  let inspected;
  try {
    inspected = readAndInspect(filePath, {
      delimiter: parseDelimiterArg(args.delimiter),
      format: args.format ? String(args.format).toLowerCase() : undefined,
    });
  } catch (err) {
    return { success: false, output: `load_dataset: ${err.message}` };
  }
  if (inspected.unsupported) {
    return { success: false, output: `load_dataset: ${inspected.unsupported_reason}` };
  }

  // ── 2. Resolve the schema ────────────────────────────────────────────
  const overrides = args.column_overrides && typeof args.column_overrides === 'object' ? args.column_overrides : {};
  const nullTokens = Array.isArray(args.null_tokens) ? args.null_tokens : undefined;
  const inferred = inferSchema(inspected, {
    sampleRows: args.sample_rows,
    overrides,
    nullTokens,
  });
  if (!inferred.columns.length) {
    return { success: false, output: 'load_dataset: no columns could be determined from this file' };
  }
  const columns = inferred.columns.map(c => ({
    column_name: c.column_name,
    selected_type: c.selected_type,
  }));
  const hash = schemaHash(inferred.columns, 1);

  // ── 3. Resolve or create the catalog dataset ─────────────────────────
  const slug = slugify(datasetName);
  const existing = state.query('SELECT * FROM datasets WHERE name = ?', [datasetName]);
  let datasetId;
  let replacing = false;

  if (existing.length) {
    if (args.replace !== true) {
      const prior = existing[0];
      // Idempotency: an identical re-load is a success, not an error. This is
      // what makes re-running an ingest safely repeatable.
      const priorSources = state.query('SELECT * FROM sources WHERE dataset_id = ? AND sha256 = ?', [Number(prior.id), inspected.sha256]);
      for (const source of priorSources) {
        const runs = state.query(
          "SELECT * FROM load_runs WHERE dataset_id = ? AND source_id = ? AND schema_hash = ? AND status = 'completed'",
          [Number(prior.id), Number(source.id), hash],
        );
        if (runs.length) {
          const run = runs[0];
          return {
            success: true,
            output: {
              dataset_id: Number(prior.id),
              name: prior.name,
              table_name: prior.table_name,
              already_loaded: true,
              load_run_id: Number(run.id),
              rows_loaded: Number(run.rows_loaded),
              rows_rejected: Number(run.rows_rejected),
              schema_hash: hash,
              note: 'this exact file (same sha256) was already loaded with this schema — nothing was written',
            },
          };
        }
      }
      return {
        success: false,
        output: `load_dataset: a dataset named "${datasetName}" already exists (id ${prior.id}) and its contents differ.`
          + ' Pass replace: true to reload it, or choose another name.',
      };
    }
    datasetId = Number(existing[0].id);
    replacing = true;
  } else {
    const now = new Date().toISOString();
    const info = state.query(
      'INSERT INTO datasets(name, table_name, quarantine_table_name, status, row_count, accepted_count, '
        + 'rejected_count, schema_hash, created_at, updated_at) VALUES(?, ?, ?, ?, 0, 0, 0, ?, ?, ?)',
      [datasetName, 'pending', 'pending', 'created', hash, now, now],
    );
    datasetId = Number(info.lastInsertRowid);
  }

  const table = tableNameFor(datasetId, slug);
  const quarantine = quarantineTableNameFor(datasetId);
  const transformVersion = replacing ? currentTransformVersion(state, datasetId) + 1 : 1;

  state.query('UPDATE datasets SET table_name = ?, quarantine_table_name = ? WHERE id = ?', [table, quarantine, datasetId]);

  // Provenance is immutable: every load gets its own source row, so a
  // re-ingest adds history instead of overwriting it.
  const sourceId = insertSource(state, {
    dataset_id: datasetId,
    path: inspected.path,
    sha256: inspected.sha256,
    size_bytes: inspected.size_bytes,
    mtime_ms: inspected.mtime_ms,
    format: inspected.format,
    encoding: inspected.encoding,
    delimiter: inspected.delimiter === '\t' ? '\\t' : inspected.delimiter,
    header_mode: inspected.header_mode,
    source_metadata: {
      newline: inspected.newline,
      header_reason: inspected.header_reason,
      record_count: inspected.records.length,
      parse_warnings: inspected.warnings.length,
      source_columns: inspected.columns,
    },
  });

  const loadRunId = startLoadRun(state, {
    dataset_id: datasetId,
    source_id: sourceId,
    transform_version: transformVersion,
    schema_hash: hash,
  });

  // ── 4. Persist the accepted schema and recipe ────────────────────────
  state.query('DELETE FROM columns WHERE dataset_id = ?', [datasetId]);
  insertColumns(state, datasetId, inferred.columns);
  insertTransforms(state, datasetId, transformVersion, inferred.columns, overrides);

  // ── 5. Load ──────────────────────────────────────────────────────────
  let db;
  try {
    db = await openWarehouse();
  } catch (err) {
    finishLoadRun(state, loadRunId, { status: 'failed', error: err.message });
    touchDataset(state, datasetId, { status: 'failed' });
    return { success: false, output: `load_dataset: ${err.message}` };
  }

  try {
    if (replacing) {
      dropDatasetTable(db, table);
      dropDatasetTable(db, quarantine);
    }
    createDatasetTable(db, table, columns);
    createQuarantineTable(db, quarantine);

    const accepted = [];
    const rejected = [];
    const signal = options.signal;

    for (const record of inspected.records) {
      if (signal && signal.aborted) {
        throw new Error('aborted by caller');
      }
      const result = coerceRecord(record, columns, { overrides, nullTokens });
      if (result.ok) accepted.push(result);
      else rejected.push({ record, errors: result.errors });
    }

    // Accepted rows first, in one transaction per batch: a failure mid-load
    // rolls the batch back rather than leaving a silently short table.
    for (let i = 0; i < accepted.length; i += BATCH_SIZE) {
      insertRows(db, table, columns, accepted.slice(i, i + BATCH_SIZE));
    }

    // Rejected rows go into the SAME warehouse file as the data, so a
    // quarantined row can never be separated from the load it belonged to.
    const nowIso = new Date().toISOString();
    db.exec('BEGIN');
    try {
      const stmt = db.prepare(
        `INSERT INTO "${quarantine}" (load_run_id, source_line, raw_record, errors_json, created_at) VALUES(?, ?, ?, ?, ?)`,
      );
      for (const item of rejected) {
        stmt.run(loadRunId, item.record.line, item.record.raw, JSON.stringify(item.errors), nowIso);
      }
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }

    const rowsLoaded = accepted.length;
    const rowsRejected = rejected.length;

    finishLoadRun(state, loadRunId, {
      status: 'completed',
      rows_seen: inspected.records.length,
      rows_loaded: rowsLoaded,
      rows_rejected: rowsRejected,
    });
    touchDataset(state, datasetId, {
      status: 'loaded',
      row_count: rowsLoaded,
      accepted_count: rowsLoaded,
      rejected_count: rowsRejected,
      schema_hash: hash,
    });
    setStatus(state, {
      active_dataset: datasetName,
      dataset_id: datasetId,
      rows: rowsLoaded,
      rejected: rowsRejected,
      updated_at: nowIso,
    });
    logEvent(state, {
      event: rowsRejected > 0 ? 'loaded_with_rejects' : 'loaded',
      dataset_id: datasetId,
      dataset: datasetName,
      rows: rowsLoaded,
      rejected: rowsRejected,
      source: inspected.path,
      at: nowIso,
    });

    return {
      success: true,
      output: {
        dataset_id: datasetId,
        name: datasetName,
        table_name: table,
        quarantine_table_name: quarantine,
        load_run_id: loadRunId,
        replaced: replacing,
        transform_version: transformVersion,
        schema_hash: hash,
        format: inspected.format,
        delimiter: inspected.delimiter === '\t' ? '\\t' : inspected.delimiter,
        rows_seen: inspected.records.length,
        rows_loaded: rowsLoaded,
        rows_rejected: rowsRejected,
        columns: inferred.columns.map(c => ({
          column_name: c.column_name,
          source_name: c.source_name,
          selected_type: c.selected_type,
          confidence: c.confidence,
        })),
        next_step: rowsRejected > 0
          ? 'call get_quarantine to see why rows were rejected'
          : 'call profile_dataset to compute the data-quality report',
      },
    };
  } catch (err) {
    finishLoadRun(state, loadRunId, {
      status: 'failed',
      error: err.message,
      rows_seen: inspected.records.length,
    });
    touchDataset(state, datasetId, { status: 'failed' });
    return { success: false, output: `load_dataset: load failed — ${err.message}` };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}
