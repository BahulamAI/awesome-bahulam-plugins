/**
 * Catalog access — the declared state tables the CLI owns.
 *
 * Everything in here goes through the state proxy (`options.state`), so the
 * catalog lives in the plugin's state.db and is reachable by the generated
 * `context_tools`. The ingested rows deliberately do NOT live here; they are
 * in the warehouse. That split is the whole design.
 */

import { schemaHash } from './types.mjs';

export function nowIso() {
  return new Date().toISOString();
}

/** A filesystem-ish slug for generated table names. */
export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'dataset';
}

export function readDataset(state, datasetId) {
  const id = Number(datasetId);
  if (!Number.isInteger(id) || id < 1) return null;
  const rows = state.query('SELECT * FROM datasets WHERE id = ?', [id]);
  return rows.length ? rows[0] : null;
}

/**
 * Resolve a dataset or produce a ready-made failure. Returning the failure
 * rather than throwing keeps the tool contract (`{success, output}`) intact
 * for every caller, including the model.
 */
export function requireDataset(state, datasetId, toolName) {
  const id = Number(datasetId);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, output: `${toolName}: \`dataset_id\` must be a positive integer` };
  }
  const dataset = readDataset(state, id);
  if (!dataset) {
    return { ok: false, output: `${toolName}: no dataset with id ${id}.` };
  }
  return { ok: true, dataset };
}

export function readColumns(state, datasetId) {
  return state.query(
    'SELECT * FROM columns WHERE dataset_id = ? ORDER BY ordinal ASC',
    [Number(datasetId)],
  );
}

export function insertColumns(state, datasetId, columns) {
  const now = nowIso();
  for (const column of columns) {
    state.query(
      'INSERT INTO columns(dataset_id, ordinal, source_name, column_name, inferred_type, selected_type, '
        + 'confidence, candidate_types, nullable, is_key_candidate, schema_reason, created_at, updated_at) '
        + 'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        Number(datasetId),
        Number(column.ordinal),
        String(column.source_name),
        String(column.column_name),
        String(column.inferred_type),
        String(column.selected_type),
        Number(column.confidence ?? 0),
        JSON.stringify(column.candidate_types ?? {}),
        column.nullable === false || column.nullable === 0 ? 0 : 1,
        column.is_key_candidate ? 1 : 0,
        column.schema_reason ? String(column.schema_reason) : null,
        now,
        now,
      ],
    );
  }
}

export function deleteColumns(state, datasetId) {
  state.query('DELETE FROM columns WHERE dataset_id = ?', [Number(datasetId)]);
}

export function insertSource(state, source) {
  const now = nowIso();
  const info = state.query(
    'INSERT INTO sources(dataset_id, path, sha256, size_bytes, mtime_ms, format, encoding, delimiter, '
      + 'header_mode, source_metadata, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      Number(source.dataset_id),
      String(source.path),
      String(source.sha256),
      Number(source.size_bytes ?? 0),
      source.mtime_ms === undefined || source.mtime_ms === null ? null : Number(source.mtime_ms),
      String(source.format || 'csv'),
      String(source.encoding || 'utf-8'),
      source.delimiter === undefined || source.delimiter === null ? null : String(source.delimiter),
      source.header_mode ? String(source.header_mode) : null,
      JSON.stringify(source.source_metadata ?? {}),
      now,
    ],
  );
  return Number(info.lastInsertRowid);
}

export function currentTransformVersion(state, datasetId) {
  const row = state.query(
    'SELECT COALESCE(MAX(version), 0) AS v FROM transforms WHERE dataset_id = ?',
    [Number(datasetId)],
  )[0];
  return Number(row?.v || 0);
}

export function insertTransforms(state, datasetId, version, columns, overrides = {}, createdBy = 'tool') {
  const now = nowIso();
  for (const column of columns) {
    const override = overrides[column.column_name] || {};
    state.query(
      'INSERT INTO transforms(dataset_id, version, column_name, trim_mode, empty_tokens, null_tokens, '
        + 'boolean_true_tokens, boolean_false_tokens, decimal_separator, thousands_separator, currency_symbols, '
        + 'date_formats, explicit_type, created_at, created_by) '
        + 'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        Number(datasetId),
        Number(version),
        String(column.column_name),
        String(override.trim_mode || 'outer'),
        JSON.stringify(override.empty_tokens ?? []),
        JSON.stringify(override.null_tokens ?? []),
        JSON.stringify(override.boolean_true_tokens ?? ['true', 't', 'yes', 'y', '1']),
        JSON.stringify(override.boolean_false_tokens ?? ['false', 'f', 'no', 'n', '0']),
        String(override.decimal_separator || '.'),
        override.thousands_separator ? String(override.thousands_separator) : null,
        JSON.stringify(override.currency_symbols ?? []),
        JSON.stringify(override.date_formats ?? []),
        override.explicit_type ? String(override.explicit_type).toUpperCase() : null,
        now,
        createdBy,
      ],
    );
  }
}

/** Read the newest recipe back as a per-column override map. */
export function readTransformOverrides(state, datasetId, version) {
  const rows = state.query(
    'SELECT * FROM transforms WHERE dataset_id = ? AND version = ?',
    [Number(datasetId), Number(version)],
  );
  const map = {};
  for (const row of rows) {
    map[row.column_name] = {
      explicit_type: row.explicit_type || undefined,
      null_tokens: safeParse(row.null_tokens, []),
      thousands_separator: row.thousands_separator || undefined,
      currency_symbols: safeParse(row.currency_symbols, []),
    };
  }
  return map;
}

function safeParse(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function startLoadRun(state, { dataset_id, source_id, transform_version, schema_hash: hash }) {
  const info = state.query(
    'INSERT INTO load_runs(dataset_id, source_id, transform_version, schema_hash, status, started_at, '
      + 'rows_seen, rows_loaded, rows_rejected, progress) VALUES(?, ?, ?, ?, ?, ?, 0, 0, 0, 0)',
    [
      Number(dataset_id),
      Number(source_id),
      Number(transform_version),
      String(hash),
      'running',
      nowIso(),
    ],
  );
  return Number(info.lastInsertRowid);
}

export function finishLoadRun(state, loadRunId, fields = {}) {
  state.query(
    'UPDATE load_runs SET status = ?, finished_at = ?, rows_seen = ?, rows_loaded = ?, '
      + 'rows_rejected = ?, progress = ?, error = ? WHERE id = ?',
    [
      String(fields.status || 'completed'),
      nowIso(),
      Number(fields.rows_seen ?? 0),
      Number(fields.rows_loaded ?? 0),
      Number(fields.rows_rejected ?? 0),
      1,
      fields.error ? String(fields.error) : null,
      Number(loadRunId),
    ],
  );
}

/**
 * Replace a dataset's findings with a fresh set.
 * Delete-then-insert rather than append, because findings describe the
 * CURRENT data — a stale "42 nulls" next to a fresh "3 nulls" is worse than
 * no finding at all.
 */
export function replaceIssues(state, datasetId, loadRunId, issues) {
  state.query('DELETE FROM issues WHERE dataset_id = ?', [Number(datasetId)]);
  const now = nowIso();
  for (const issue of issues) {
    state.query(
      'INSERT INTO issues(dataset_id, load_run_id, column_id, issue_type, severity, count, sample_lines, '
        + 'details, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        Number(datasetId),
        loadRunId === undefined || loadRunId === null ? null : Number(loadRunId),
        null,
        String(issue.issue_type),
        String(issue.severity || 'low'),
        Number(issue.count ?? 0),
        issue.sample_lines === undefined || issue.sample_lines === null ? null : String(issue.sample_lines),
        String(issue.details || ''),
        now,
      ],
    );
  }
}

export function saveReport(state, { dataset_id, load_run_id, profile, summary }) {
  const now = nowIso();
  state.query(
    'INSERT INTO quality_reports(dataset_id, load_run_id, computed_at, full_scan, metrics_json, summary) '
      + 'VALUES(?, ?, ?, ?, ?, ?)',
    [
      Number(dataset_id),
      Number(load_run_id),
      now,
      profile.full_scan ? 1 : 0,
      JSON.stringify(profile),
      String(summary),
    ],
  );
}

export function touchDataset(state, datasetId, fields = {}) {
  const sets = [];
  const params = [];
  if (fields.status !== undefined) { sets.push('status = ?'); params.push(String(fields.status)); }
  if (fields.row_count !== undefined) { sets.push('row_count = ?'); params.push(Number(fields.row_count)); }
  if (fields.accepted_count !== undefined) { sets.push('accepted_count = ?'); params.push(Number(fields.accepted_count)); }
  if (fields.rejected_count !== undefined) { sets.push('rejected_count = ?'); params.push(Number(fields.rejected_count)); }
  if (fields.schema_hash !== undefined) { sets.push('schema_hash = ?'); params.push(String(fields.schema_hash)); }
  sets.push('updated_at = ?');
  params.push(nowIso());
  state.query(`UPDATE datasets SET ${sets.join(', ')} WHERE id = ?`, [...params, Number(datasetId)]);
}

/** The tiny per-turn slice the agent sees. Deliberately not the data. */
export function setStatus(state, patch) {
  state.patch('cleanroom_status', patch);
}

export function logEvent(state, payload) {
  state.append('cleanroom_log', payload);
}

export { schemaHash };
