/**
 * describe_stats — statistical summary for numeric and categorical columns
 */

import { get } from './dataset-store.mjs';

export const name = 'describe_stats';
export const description = 'Statistical summary for numeric/categorical columns';

function numericStats(values) {
  const valid = values.filter(v => v !== null && v !== '' && v !== undefined).map(Number).filter(n => !isNaN(n));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const n = valid.length;
  const mean = valid.reduce((s, v) => s + v, 0) / n;
  const variance = valid.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    count: n,
    missing: values.length - n,
    missing_pct: Math.round((1 - n / values.length) * 10000) / 100,
    mean: Math.round(mean * 100) / 100,
    median: sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    std: Math.round(Math.sqrt(variance) * 100) / 100,
    q1: sorted[Math.round(n * 0.25)],
    q3: sorted[Math.round(n * 0.75)],
  };
}

function categoricalStats(values) {
  const valid = values.filter(v => v !== null && v !== '' && v !== undefined);
  const freq = {};
  valid.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return {
    count: valid.length,
    missing: values.length - valid.length,
    missing_pct: Math.round((1 - valid.length / values.length) * 10000) / 100,
    unique: Object.keys(freq).length,
    top: sorted[0]?.[0] ?? null,
    freq: sorted[0]?.[1] ?? 0,
    top_5: sorted.slice(0, 5),
  };
}

export async function call(args = {}) {
  const { dataset, columns } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const { data, meta } = entry;
  const allCols = meta.columns || [];
  const targetCols = columns && columns.length
    ? allCols.filter(c => columns.includes(c.name))
    : allCols;

  const stats = targetCols.map(col => {
    const vals = data.map(r => r[col.name]);
    if (col.type === 'float' || col.type === 'integer') {
      return { column: col.name, type: col.type, stats: numericStats(vals) };
    }
    return { column: col.name, type: col.type, stats: categoricalStats(vals) };
  });

  return {
    success: true,
    output: {
      dataset,
      rows: data.length,
      columns: stats,
    },
  };
}