/**
 * filter_rows — filter a dataset by column-operator-value conditions
 */

import { get, set } from './dataset-store.mjs';

export const name = 'filter_rows';
export const description = 'Filter a dataset by conditions';

function applyOp(value, op, target) {
  switch (op) {
    case 'eq': return String(value) === String(target);
    case 'ne': return String(value) !== String(target);
    case 'gt': return Number(value) > Number(target);
    case 'gte': return Number(value) >= Number(target);
    case 'lt': return Number(value) < Number(target);
    case 'lte': return Number(value) <= Number(target);
    case 'contains': return String(value).toLowerCase().includes(String(target).toLowerCase());
    case 'regex': {
      try { return new RegExp(target).test(String(value)); } catch { return false; }
    }
    case 'in': return Array.isArray(target) && target.some(t => String(value) === String(t));
    case 'not_in': return Array.isArray(target) && !target.some(t => String(value) === String(t));
    default: return false;
  }
}

export async function call(args = {}) {
  const { dataset, conditions, name: outName } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!conditions || !conditions.length) return { success: false, error: 'at least one condition is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const filtered = entry.data.filter(row => {
    return conditions.every(c => {
      const val = row[c.column];
      return applyOp(val, c.op, c.value);
    });
  });

  const resultName = outName || dataset + '_filtered';
  set(resultName, filtered, { ...entry.meta, source: dataset });

  return {
    success: true,
    output: {
      name: resultName,
      before: entry.data.length,
      after: filtered.length,
      removed: entry.data.length - filtered.length,
    },
  };
}