/**
 * sort_data — sort dataset by column(s)
 */

import { get, set } from './dataset-store.mjs';

export const name = 'sort_data';
export const description = 'Sort dataset by one or more columns';

export async function call(args = {}) {
  const { dataset, sort, name: outName } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!sort || !sort.length) return { success: false, error: 'at least one sort column is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const sorted = [...entry.data].sort((a, b) => {
    for (const s of sort) {
      const dir = s.direction === 'desc' ? -1 : 1;
      const va = a[s.column], vb = b[s.column];
      // Try numeric comparison first
      const na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        if (na !== nb) return (na < nb ? -1 : 1) * dir;
      } else {
        const cmp = String(va ?? '').localeCompare(String(vb ?? ''));
        if (cmp !== 0) return cmp * dir;
      }
    }
    return 0;
  });

  const resultName = outName || dataset + '_sorted';
  set(resultName, sorted, { ...entry.meta, source: dataset });

  return {
    success: true,
    output: {
      name: resultName,
      rows: sorted.length,
      sort,
    },
  };
}