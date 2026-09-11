/**
 * Quality profiling.
 *
 * The computed half of the product. Every number here is derived from the
 * data by a query, never asserted by a model — which is the property that
 * separates a report from an opinion.
 *
 * Metrics are split into cheap and scan-heavy so the caller can decide
 * whether to run the expensive ones (and the report can say which ran).
 */

import { assertIdentifier, quoteIdent, sqliteTypeFor, SOURCE_LINE_COLUMN } from './warehouse.mjs';

/** Numeric types we can average and outlier-test. */
const NUMERIC = new Set(['INTEGER', 'REAL', 'BOOLEAN']);

/**
 * Tukey bounds using SQLite-ordered quantiles rather than pulling the column
 * into JS — the offsets make this O(1) memory regardless of row count.
 */
function quantile(db, table, column, fraction, count) {
  if (count <= 0) return null;
  const offset = Math.max(0, Math.min(count - 1, Math.floor(fraction * (count - 1))));
  const row = db.prepare(
    `SELECT ${quoteIdent(column)} AS v FROM ${quoteIdent(table)} `
      + `WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY ${quoteIdent(column)} ASC LIMIT 1 OFFSET ?`,
  ).get(offset);
  return row ? Number(row.v) : null;
}

/**
 * Profile every column of a dataset table.
 *
 * @param {object} db open warehouse handle
 * @param {string} table dataset table name
 * @param {Array<{column_name:string, selected_type:string}>} columns
 * @param {{fullScan?:boolean, highCardinalityRatio?:number}} [opts]
 */
export function profileTable(db, table, columns, opts = {}) {
  assertIdentifier(table);
  const fullScan = opts.fullScan !== false;
  const highRatio = Number.isFinite(opts.highCardinalityRatio) ? opts.highCardinalityRatio : 0.98;

  const rowCount = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get().n || 0);

  const columnMetrics = [];
  const issues = [];

  for (const column of columns) {
    const name = column.column_name;
    const type = String(column.selected_type || 'TEXT').toUpperCase();
    assertIdentifier(name);
    const q = quoteIdent(name);

    const base = db.prepare(
      `SELECT COUNT(*) AS total, `
        + `SUM(CASE WHEN ${q} IS NULL THEN 1 ELSE 0 END) AS nulls, `
        + `COUNT(${q}) AS non_null, `
        + `COUNT(DISTINCT ${q}) AS distinct_count `
        + `FROM ${quoteIdent(table)}`,
    ).get();

    const total = Number(base.total || 0);
    const nulls = Number(base.nulls || 0);
    const nonNull = Number(base.non_null || 0);
    const distinct = Number(base.distinct_count || 0);

    const metrics = {
      column_name: name,
      selected_type: type,
      total,
      null_count: nulls,
      null_rate: total ? Math.round((nulls / total) * 1000) / 1000 : 1,
      non_null_count: nonNull,
      distinct_count: distinct,
      distinct_ratio: nonNull ? Math.round((distinct / nonNull) * 1000) / 1000 : 0,
      is_constant: nonNull > 0 && distinct === 1,
      min_value: null,
      max_value: null,
      mean_value: null,
      outlier_count: 0,
      outlier_low: null,
      outlier_high: null,
      min_length: null,
      max_length: null,
    };

    if (fullScan && nonNull > 0) {
      const agg = db.prepare(
        `SELECT MIN(${q}) AS mn, MAX(${q}) AS mx FROM ${quoteIdent(table)}`,
      ).get();
      metrics.min_value = agg.mn === null || agg.mn === undefined ? null : String(agg.mn);
      metrics.max_value = agg.mx === null || agg.mx === undefined ? null : String(agg.mx);

      if (NUMERIC.has(type)) {
        const meanRow = db.prepare(`SELECT AVG(${q}) AS a FROM ${quoteIdent(table)}`).get();
        metrics.mean_value = meanRow && meanRow.a !== null && meanRow.a !== undefined
          ? Math.round(Number(meanRow.a) * 1000) / 1000
          : null;

        if (nonNull >= 4) {
          const q1 = quantile(db, table, name, 0.25, nonNull);
          const q3 = quantile(db, table, name, 0.75, nonNull);
          if (q1 !== null && q3 !== null) {
            const iqr = q3 - q1;
            if (iqr > 0) {
              const low = q1 - 1.5 * iqr;
              const high = q3 + 1.5 * iqr;
              const out = db.prepare(
                `SELECT COUNT(*) AS n FROM ${quoteIdent(table)} `
                  + `WHERE ${q} IS NOT NULL AND (${q} < ? OR ${q} > ?)`,
              ).get(low, high);
              metrics.outlier_count = Number(out.n || 0);
              metrics.outlier_low = Math.round(low * 1000) / 1000;
              metrics.outlier_high = Math.round(high * 1000) / 1000;
            }
          }
        }
      } else {
        const len = db.prepare(
          `SELECT MIN(LENGTH(${q})) AS mn, MAX(LENGTH(${q})) AS mx FROM ${quoteIdent(table)}`,
        ).get();
        metrics.min_length = len.mn === null || len.mn === undefined ? null : Number(len.mn);
        metrics.max_length = len.mx === null || len.mx === undefined ? null : Number(len.mx);
      }
    }

    columnMetrics.push(metrics);

    // ── Derived findings. Each one is a verdict with its evidence attached. ──
    if (total > 0 && metrics.null_rate === 1) {
      issues.push({ column_name: name, issue_type: 'all_null', severity: 'high', count: total, details: 'every value is null or a null token' });
    } else if (total >= 5 && metrics.null_rate >= 0.2) {
      issues.push({
        column_name: name,
        issue_type: 'null_rate',
        severity: metrics.null_rate >= 0.5 ? 'high' : 'medium',
        count: nulls,
        details: `${Math.round(metrics.null_rate * 100)}% of rows (${nulls}/${total}) are null`,
      });
    }
    if (metrics.is_constant) {
      issues.push({ column_name: name, issue_type: 'constant_column', severity: 'low', count: nonNull, details: `only one distinct value: ${metrics.min_value}` });
    }
    if (nonNull >= 20 && type !== 'TEXT' && metrics.distinct_ratio >= highRatio) {
      issues.push({
        column_name: name,
        issue_type: 'high_cardinality',
        severity: 'low',
        count: distinct,
        details: `${Math.round(metrics.distinct_ratio * 100)}% of values are distinct — likely an identifier rather than a ${type}`,
      });
    }
    if (metrics.outlier_count > 0) {
      issues.push({
        column_name: name,
        issue_type: 'outlier',
        severity: 'low',
        count: metrics.outlier_count,
        details: `${metrics.outlier_count} value(s) outside Tukey bounds [${metrics.outlier_low}, ${metrics.outlier_high}]`,
      });
    }
  }

  // ── Row-level duplicates ────────────────────────────────────────────
  let duplicateGroups = 0;
  let duplicateRows = 0;
  if (fullScan && columns.length) {
    const cols = columns.map(c => quoteIdent(c.column_name)).join(', ');
    const dup = db.prepare(
      `SELECT COALESCE(SUM(n - 1), 0) AS extra, COUNT(*) AS groups FROM (`
        + `SELECT COUNT(*) AS n FROM ${quoteIdent(table)} GROUP BY ${cols} HAVING COUNT(*) > 1)`,
    ).get();
    duplicateGroups = Number(dup.groups || 0);
    duplicateRows = Number(dup.extra || 0);
    if (duplicateRows > 0) {
      issues.push({
        column_name: '',
        issue_type: 'duplicate_rows',
        severity: duplicateRows > rowCount / 2 ? 'high' : 'medium',
        count: duplicateRows,
        details: `${duplicateRows} exact duplicate row(s) across ${duplicateGroups} group(s)`,
      });
    }
  }

  const quarantined = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get();
  void quarantined;

  return {
    row_count: rowCount,
    column_count: columns.length,
    full_scan: fullScan,
    duplicate_groups: duplicateGroups,
    duplicate_rows: duplicateRows,
    columns: columnMetrics,
    issues,
  };
}

/**
 * Candidate keys: columns that are non-null and unique across every row.
 * Cheap to derive from metrics that were already computed, and it is the
 * question a schema reviewer actually asks first.
 */
export function detectCandidateKeys(profile) {
  return (profile.columns || [])
    .filter(c => c.non_null_count > 0 && c.null_count === 0 && c.distinct_count === c.total)
    .map(c => ({ column_name: c.column_name, selected_type: c.selected_type, distinct_count: c.distinct_count }));
}

/** One-line human summary of a profile, used in the report and the panel. */
export function summarizeProfile(profile) {
  const high = (profile.issues || []).filter(i => i.severity === 'high').length;
  const medium = (profile.issues || []).filter(i => i.severity === 'medium').length;
  const low = (profile.issues || []).filter(i => i.severity === 'low').length;
  const scan = profile.full_scan ? 'full scan' : 'sampled';
  return `${profile.row_count} row(s) × ${profile.column_count} column(s); ${scan}; `
    + `${high} high / ${medium} medium / ${low} low finding(s)`
    + (profile.duplicate_rows ? `; ${profile.duplicate_rows} duplicate row(s)` : '');
}

export { SOURCE_LINE_COLUMN, sqliteTypeFor };
