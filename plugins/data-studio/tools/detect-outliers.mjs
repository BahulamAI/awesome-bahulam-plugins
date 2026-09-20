/**
 * detect_outliers — flag numeric outliers using IQR or z-score method
 */

import { get, set } from './dataset-store.mjs';

export const name = 'detect_outliers';
export const description = 'Flag numeric outliers via IQR or z-score';

export async function call(args = {}) {
  const { dataset, column, method = 'iqr', threshold, name: outName } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!column) return { success: false, error: 'column name is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const values = entry.data.map(r => Number(r[column])).filter(n => !isNaN(n));
  if (values.length < 4) return { success: false, error: `Need at least 4 numeric values in "${column}", got ${values.length}` };

  const result = entry.data.map(row => {
    const val = Number(row[column]);
    const isOutlier = !isNaN(val) ? _isOutlier(val, values, method, threshold) : false;
    return { ...row, [`${column}_outlier`]: isOutlier };
  });

  const resultName = outName || dataset + '_outliers';
  const outlierCount = result.filter(r => r[`${column}_outlier`]).length;
  set(resultName, result, { ...entry.meta, source: dataset });

  return {
    success: true,
    output: {
      name: resultName,
      rows: result.length,
      column,
      method,
      outliers: outlierCount,
      outlier_pct: Math.round(outlierCount / result.length * 10000) / 100,
    },
  };
}

function _isOutlier(val, all, method, threshold) {
  if (method === 'zscore') {
    const n = all.length;
    const mean = all.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    const cutoff = threshold ?? 3;
    return Math.abs((val - mean) / (std || 1)) > cutoff;
  }
  // IQR
  const sorted = [...all].sort((a, b) => a - b);
  const q1 = sorted[Math.round(sorted.length * 0.25)];
  const q3 = sorted[Math.round(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const mult = threshold ?? 1.5;
  return val < q1 - mult * iqr || val > q3 + mult * iqr;
}