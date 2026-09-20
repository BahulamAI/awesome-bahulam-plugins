/**
 * group_aggregate — group by columns and compute aggregations
 */

import { get, set } from './dataset-store.mjs';

export const name = 'group_aggregate';
export const description = 'Group by columns and compute aggregations';

const fns = {
  sum: (vals) => vals.reduce((s, v) => s + (isNaN(Number(v)) ? 0 : Number(v)), 0),
  avg: (vals) => {
    const nums = vals.map(Number).filter(n => !isNaN(n));
    return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
  },
  count: (vals) => vals.length,
  min: (vals) => Math.min(...vals.map(Number).filter(n => !isNaN(n))),
  max: (vals) => Math.max(...vals.map(Number).filter(n => !isNaN(n))),
  std: (vals) => {
    const nums = vals.map(Number).filter(n => !isNaN(n));
    if (nums.length < 2) return 0;
    const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
    return Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / (nums.length - 1));
  },
  first: (vals) => vals[0],
  last: (vals) => vals[vals.length - 1],
};

export async function call(args = {}) {
  const { dataset, by, aggregations, name: outName } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!by || !by.length) return { success: false, error: 'at least one group-by column is required' };
  if (!aggregations || !aggregations.length) return { success: false, error: 'at least one aggregation is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const groups = {};
  for (const row of entry.data) {
    const key = by.map(c => String(row[c] ?? '')).join('||');
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const result = Object.entries(groups).map(([key, rows]) => {
    const groupKey = {};
    by.forEach((c, i) => { groupKey[c] = rows[0][c]; });
    const aggs = {};
    aggregations.forEach(a => {
      const vals = rows.map(r => r[a.column]);
      aggs[a.as || a.column] = (fns[a.fn] || fns.count)(vals);
    });
    return { ...groupKey, ...aggs };
  });

  const resultName = outName || dataset + '_grouped';
  set(resultName, result, { ...entry.meta, source: dataset, groupBy: by });

  return {
    success: true,
    output: {
      name: resultName,
      rows: result.length,
      groups: Object.keys(groups).length,
      columns: [...by, ...aggregations.map(a => a.as || a.column)],
    },
  };
}