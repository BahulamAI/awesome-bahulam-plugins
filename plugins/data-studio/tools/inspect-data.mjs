/**
 * inspect_data — return column info and sample rows from a loaded dataset
 */

import { get } from './dataset-store.mjs';

export const name = 'inspect_data';
export const description = 'Show column info and sample rows for a loaded dataset';

export async function call(args = {}) {
  const { dataset, rows: n = 5 } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const { data, meta } = entry;
  const sample = data.slice(0, Math.min(n, data.length));

  return {
    success: true,
    output: {
      name: dataset,
      rows: data.length,
      columns: meta.columns || [],
      sample,
    },
  };
}