/**
 * select_columns — project a subset of columns, with optional rename
 */

import { get, set } from './dataset-store.mjs';

export const name = 'select_columns';
export const description = 'Project a subset of columns, optionally renaming';

export async function call(args = {}) {
  const { dataset, columns, name: outName } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!columns || !columns.length) return { success: false, error: 'at least one column is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  // Normalize to [{from, to}]
  const mapping = columns.map(c => {
    if (typeof c === 'string') return { from: c, to: c };
    return { from: c.from, to: c.to || c.from };
  });

  const projected = entry.data.map(row => {
    const out = {};
    mapping.forEach(m => { out[m.to] = row[m.from] !== undefined ? row[m.from] : null; });
    return out;
  });

  const resultName = outName || dataset + '_projected';
  const cols = mapping.map(m => ({ name: m.to }));
  set(resultName, projected, { ...entry.meta, source: dataset, columns: cols });

  return {
    success: true,
    output: {
      name: resultName,
      rows: projected.length,
      columns: mapping.map(m => m.to),
    },
  };
}