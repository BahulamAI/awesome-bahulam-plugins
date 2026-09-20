/**
 * export_data — write a processed dataset to disk
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { get } from './dataset-store.mjs';

export const name = 'export_data';
export const description = 'Export a dataset to CSV, JSON, or JSONL';

export async function call(args = {}) {
  const { dataset, path, format: fmt } = args;
  if (!dataset) return { success: false, error: 'dataset name is required' };
  if (!path) return { success: false, error: 'output path is required' };

  let entry;
  try { entry = get(dataset); } catch (e) { return { success: false, error: e.message }; }

  const fullPath = resolve(process.cwd(), path);
  const ext = path.toLowerCase().match(/\.(\w+)$/)?.[1];
  const format = fmt || ext || 'csv';
  const data = entry.data;

  let output;
  if (format === 'json') {
    output = JSON.stringify(data, null, 2);
  } else if (format === 'jsonl') {
    output = data.map(r => JSON.stringify(r)).join('\n');
  } else {
    // CSV
    const cols = Object.keys(data[0] || {});
    const lines = [cols.map(escapeCSV).join(',')];
    for (const row of data) {
      lines.push(cols.map(c => escapeCSV(row[c])).join(','));
    }
    output = lines.join('\n');
  }

  writeFileSync(fullPath, output, 'utf-8');

  return {
    success: true,
    output: {
      path: fullPath,
      rows: data.length,
      format,
      size: Buffer.byteLength(output, 'utf-8'),
    },
  };
}

function escapeCSV(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}