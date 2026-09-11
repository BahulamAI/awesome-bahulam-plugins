/**
 * export_report — produce the report as an artifact.
 *
 * The deliverable. A report that only exists as a tool result inside one
 * conversation is not a report; it is a message. This renders the catalog +
 * computed metrics into something the user can keep, diff against a later
 * run, or paste into a ticket.
 *
 * Output is deterministic: sections and rows are explicitly ordered, so two
 * exports of the same data are byte-identical.
 */

import { readColumns, requireDataset } from './lib/catalog.mjs';
import { detectCandidateKeys } from './lib/profile.mjs';

export const name = 'export_report';
export const description = 'Export the dataset quality report as JSON, CSV or Markdown for keeping';

export const FORMATS = ['json', 'csv', 'markdown'];

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function parseJson(text, fallback) {
  try { const v = JSON.parse(text); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Assemble every fact the report needs, in one place. */
function gather(state, dataset) {
  const datasetId = Number(dataset.id);
  const columns = readColumns(state, datasetId);
  const sources = state.query('SELECT * FROM sources WHERE dataset_id = ? ORDER BY id ASC', [datasetId]);
  const runs = state.query('SELECT * FROM load_runs WHERE dataset_id = ? ORDER BY id ASC', [datasetId]);
  const issueRows = state.query('SELECT * FROM issues WHERE dataset_id = ?', [datasetId]);
  const reportRows = state.query('SELECT * FROM quality_reports WHERE dataset_id = ? ORDER BY id DESC LIMIT 1', [datasetId]);

  const latestRun = runs.length ? runs[runs.length - 1] : null;
  const profile = reportRows.length ? parseJson(reportRows[0].metrics_json, null) : null;
  const metrics = profile && Array.isArray(profile.columns) ? profile.columns : [];

  const issues = issueRows
    .map(row => ({
      issue_type: row.issue_type,
      severity: row.severity,
      column_name: row.column_name || '',
      count: Number(row.count || 0),
      details: row.details,
    }))
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
      || String(a.column_name).localeCompare(String(b.column_name))
      || String(a.issue_type).localeCompare(String(b.issue_type)));

  return {
    dataset: {
      id: datasetId,
      name: dataset.name,
      status: dataset.status,
      table_name: dataset.table_name,
      row_count: Number(dataset.row_count || 0),
      rejected_count: Number(dataset.rejected_count || 0),
      schema_hash: dataset.schema_hash,
      created_at: dataset.created_at,
      updated_at: dataset.updated_at,
    },
    provenance: sources.map(row => ({
      source_id: Number(row.id),
      path: row.path,
      sha256: row.sha256,
      size_bytes: Number(row.size_bytes || 0),
      format: row.format,
      encoding: row.encoding,
      delimiter: row.delimiter,
      header_mode: row.header_mode,
      loaded_at: row.created_at,
    })),
    load_runs: runs.map(row => ({
      load_run_id: Number(row.id),
      status: row.status,
      started_at: row.started_at,
      finished_at: row.finished_at,
      transform_version: Number(row.transform_version || 0),
      schema_hash: row.schema_hash,
      rows_seen: Number(row.rows_seen || 0),
      rows_loaded: Number(row.rows_loaded || 0),
      rows_rejected: Number(row.rows_rejected || 0),
      error: row.error,
    })),
    schema: columns.map(c => ({
      ordinal: Number(c.ordinal),
      source_name: c.source_name,
      column_name: c.column_name,
      inferred_type: c.inferred_type,
      selected_type: c.selected_type,
      confidence: Number(c.confidence || 0),
      nullable: Number(c.nullable) === 1,
      reason: c.schema_reason,
    })),
    metrics: metrics.map(m => ({
      column_name: m.column_name,
      selected_type: m.selected_type,
      null_rate: m.null_rate,
      null_count: m.null_count,
      distinct_count: m.distinct_count,
      distinct_ratio: m.distinct_ratio,
      min_value: m.min_value,
      max_value: m.max_value,
      mean_value: m.mean_value,
      outlier_count: m.outlier_count,
      is_constant: m.is_constant,
    })),
    duplicate_rows: profile ? Number(profile.duplicate_rows || 0) : null,
    candidate_keys: profile ? (profile.candidate_keys || detectCandidateKeys(profile)) : [],
    issues,
    summary: reportRows.length ? reportRows[0].summary : 'not profiled yet',
    computed_at: reportRows.length ? reportRows[0].computed_at : null,
    latest_load_run_id: latestRun ? Number(latestRun.id) : null,
  };
}

function toCsv(report) {
  const lines = [];
  lines.push('column_name,selected_type,null_rate,distinct_count,min_value,max_value,mean_value,outlier_count,is_constant');
  for (const m of report.metrics) {
    lines.push([
      csvCell(m.column_name), csvCell(m.selected_type), csvCell(m.null_rate), csvCell(m.distinct_count),
      csvCell(m.min_value), csvCell(m.max_value), csvCell(m.mean_value), csvCell(m.outlier_count),
      csvCell(m.is_constant ? 1 : 0),
    ].join(','));
  }
  return lines.join('\n');
}

function toMarkdown(report) {
  const out = [];
  out.push(`# Data quality report — ${report.dataset.name}`);
  out.push('');
  out.push(`- dataset id: ${report.dataset.id}`);
  out.push(`- table: \`${report.dataset.table_name}\``);
  out.push(`- status: ${report.dataset.status}`);
  out.push(`- rows loaded: ${report.dataset.row_count}`);
  out.push(`- rows rejected: ${report.dataset.rejected_count}`);
  out.push(`- schema hash: ${report.dataset.schema_hash || 'n/a'}`);
  out.push(`- profiled at: ${report.computed_at || 'not profiled'}`);
  out.push(`- summary: ${report.summary}`);
  out.push('');
  out.push('## Provenance');
  out.push('');
  for (const source of report.provenance) {
    out.push(`- \`${source.path}\` (${source.format}, ${source.encoding}, delimiter \`${source.delimiter}\`) sha256 \`${source.sha256.slice(0, 16)}…\``);
  }
  out.push('');
  out.push('## Schema');
  out.push('');
  out.push('| column | source | type | confidence | nullable |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const c of report.schema) {
    out.push(`| ${c.column_name} | ${c.source_name} | ${c.selected_type} | ${c.confidence} | ${c.nullable ? 'yes' : 'no'} |`);
  }
  out.push('');
  out.push('## Column metrics');
  out.push('');
  out.push('| column | type | null rate | distinct | min | max | mean | outliers |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const m of report.metrics) {
    out.push(`| ${m.column_name} | ${m.selected_type} | ${m.null_rate} | ${m.distinct_count} | ${m.min_value ?? ''} | ${m.max_value ?? ''} | ${m.mean_value ?? ''} | ${m.outlier_count ?? 0} |`);
  }
  out.push('');
  out.push('## Findings');
  out.push('');
  if (!report.issues.length) {
    out.push('No findings.');
  } else {
    out.push('| severity | column | issue | count | detail |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const i of report.issues) {
      out.push(`| ${i.severity} | ${i.column_name || '(row)'} | ${i.issue_type} | ${i.count} | ${i.details} |`);
    }
  }
  if (report.candidate_keys.length) {
    out.push('');
    out.push(`Candidate keys: ${report.candidate_keys.map(k => `\`${k.column_name}\``).join(', ')}`);
  }
  return out.join('\n');
}

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'export_report: plugin state unavailable' };

  const resolved = requireDataset(state, args.dataset_id, 'export_report');
  if (!resolved.ok) return { success: false, output: resolved.output };

  const format = String(args.format || 'json').toLowerCase();
  if (!FORMATS.includes(format)) {
    return { success: false, output: `export_report: \`format\` must be one of ${FORMATS.join(', ')}` };
  }

  try {
    const report = gather(state, resolved.dataset);
    let artifact;
    if (format === 'csv') artifact = toCsv(report);
    else if (format === 'markdown') artifact = toMarkdown(report);
    else artifact = JSON.stringify(report, null, 2);

    return {
      success: true,
      output: {
        dataset_id: report.dataset.id,
        format,
        bytes: Buffer.byteLength(artifact, 'utf8'),
        profiled: report.computed_at !== null,
        finding_count: report.issues.length,
        artifact,
      },
    };
  } catch (err) {
    return { success: false, output: `export_report: ${err.message}` };
  }
}
