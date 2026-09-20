/**
 * load_dataset — parse a CSV/JSON/JSONL/TSV file into the in-memory store
 *
 * Uses Node built-in fs + a minimal CSV parser (no external deps).
 * Infers column types from the first 100 rows.
 */

import { readFileSync, existsSync } from 'fs';
import { extname, resolve } from 'path';
import { get, set } from './dataset-store.mjs';

export const name = 'load_dataset';
export const description = 'Load a CSV, JSON, JSONL, or TSV file as a named dataset';

function detectFormat(path, format) {
  if (format && format !== 'auto') return format;
  const ext = extname(path).toLowerCase();
  const map = { '.csv': 'csv', '.tsv': 'tsv', '.json': 'json', '.jsonl': 'jsonl' };
  return map[ext] || 'csv';
}

function parseCSV(text, sep = ',') {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { columns: [], rows: [] };
  const header = lines[0].split(sep).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(v => v.trim());
    if (vals.length === 1 && vals[0] === '') continue;
    const row = {};
    header.forEach((h, idx) => { row[h] = vals[idx] !== undefined ? vals[idx] : null; });
    rows.push(row);
  }
  return { columns: header, rows };
}

function parseJSON(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : [data];
  if (!arr.length) return { columns: [], rows: [] };
  const columns = Object.keys(arr[0]);
  return { columns, rows: arr };
}

function parseJSONL(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const rows = lines.map(l => JSON.parse(l));
  if (!rows.length) return { columns: [], rows: [] };
  const columns = Object.keys(rows[0]);
  return { columns, rows };
}

function inferTypes(rows, columns) {
  const sample = rows.slice(0, 100);
  return columns.map(col => {
    const vals = sample.map(r => r[col]).filter(v => v !== null && v !== '' && v !== undefined);
    if (!vals.length) return { name: col, type: 'string', nullable: true };
    // Check if all are numbers
    const nums = vals.map(v => Number(v));
    const allNumeric = nums.every(n => !isNaN(n));
    if (allNumeric) {
      const allInt = nums.every(n => Number.isInteger(n));
      return { name: col, type: allInt ? 'integer' : 'float', nullable: vals.length < rows.length };
    }
    // Check date patterns
    const dateLike = vals.some(v => /^\d{4}[/-]\d{2}[/-]\d{2}/.test(String(v)));
    if (dateLike) return { name: col, type: 'date', nullable: vals.length < rows.length };
    return { name: col, type: 'string', nullable: vals.length < rows.length };
  });
}

export async function call(args = {}) {
  const { path, name: alias, format: fmt } = args;
  if (!path) return { success: false, error: 'path is required' };

  // Resolve relative to cwd, or use as-is if absolute
  const fullPath = resolve(process.cwd(), path);
  if (!existsSync(fullPath)) return { success: false, error: `File not found: ${fullPath}` };

  const text = readFileSync(fullPath, 'utf-8');
  const format = detectFormat(fullPath, fmt);

  let columns, rows;
  try {
    if (format === 'csv') {
      const r = parseCSV(text, ',');
      columns = r.columns; rows = r.rows;
    } else if (format === 'tsv') {
      const r = parseCSV(text, '\t');
      columns = r.columns; rows = r.rows;
    } else if (format === 'json') {
      const r = parseJSON(text);
      columns = r.columns; rows = r.rows;
    } else if (format === 'jsonl') {
      const r = parseJSONL(text);
      columns = r.columns; rows = r.rows;
    } else {
      return { success: false, error: `Unsupported format: ${format}` };
    }
  } catch (e) {
    return { success: false, error: `Parse error: ${e.message}` };
  }

  if (!rows.length) return { success: false, error: 'File is empty or has no data rows' };

  const types = inferTypes(rows, columns);
  const datasetName = alias || path.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
  const sample = rows.slice(0, 5);

  set(datasetName, rows, {
    columns: types,
    format,
    path: fullPath,
    rowCount: rows.length,
  });

  return {
    success: true,
    output: {
      name: datasetName,
      rows: rows.length,
      columns: types,
      sample,
      format,
      path: fullPath,
    },
  };
}