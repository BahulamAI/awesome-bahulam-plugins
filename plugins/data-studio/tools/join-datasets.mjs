/**
 * join_datasets — merge two datasets on a common key
 */

import { get, set } from './dataset-store.mjs';

export const name = 'join_datasets';
export const description = 'Merge two datasets on a key column (inner, left, right, outer)';

function buildLookup(rows, keys) {
  const map = new Map();
  for (const row of rows) {
    const key = keys.map(k => String(row[k] ?? '')).join('||');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

export async function call(args = {}) {
  const { left, right, on, how = 'inner', name: outName } = args;
  if (!left) return { success: false, error: 'left dataset is required' };
  if (!right) return { success: false, error: 'right dataset is required' };
  if (!on) return { success: false, error: 'join key (on) is required' };

  let leftEntry, rightEntry;
  try { leftEntry = get(left); } catch (e) { return { success: false, error: `Left: ${e.message}` }; }
  try { rightEntry = get(right); } catch (e) { return { success: false, error: `Right: ${e.message}` }; }

  // Normalize join keys
  const leftKeys = Array.isArray(on) ? on.map(o => o.left || o) : [on];
  const rightKeys = Array.isArray(on) ? on.map(o => o.right || o.left || o) : [on];

  const rightLookup = buildLookup(rightEntry.data, rightKeys);
  const leftRows = leftEntry.data;
  const result = [];
  const seenRight = new Set();

  // Determine column sets
  const leftCols = Object.keys(leftRows[0] || {});
  const rightCols = Object.keys(rightEntry.data[0] || {});
  const rightSuffixCols = rightCols.filter(c => !rightKeys.includes(c));

  for (const leftRow of leftRows) {
    const key = leftKeys.map(k => String(leftRow[k] ?? '')).join('||');
    const matching = rightLookup.get(key);
    if (matching) {
      seenRight.add(key);
      for (const rightRow of matching) {
        result.push({ ...leftRow, ...rightRow });
      }
    } else if (how === 'left' || how === 'outer') {
      const emptyRight = {};
      rightSuffixCols.forEach(c => { emptyRight[c] = null; });
      result.push({ ...leftRow, ...emptyRight });
    }
  }

  if (how === 'right' || how === 'outer') {
    for (const rightRow of rightEntry.data) {
      const key = rightKeys.map(k => String(rightRow[k] ?? '')).join('||');
      if (!seenRight.has(key)) {
        const emptyLeft = {};
        leftCols.forEach(c => { emptyLeft[c] = null; });
        result.push({ ...emptyLeft, ...rightRow });
      }
    }
  }

  const resultName = outName || left + '_' + right;
  set(resultName, result, { source: `${left} ⨝ ${right}`, joinType: how });

  return {
    success: true,
    output: {
      name: resultName,
      rows: result.length,
      left: leftEntry.data.length,
      right: rightEntry.data.length,
      joinType: how,
    },
  };
}