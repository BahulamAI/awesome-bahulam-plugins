/**
 * Warehouse management — the plugin's OWN SQLite file for ingested rows.
 *
 * Why a second database rather than tables in the plugin's state.db:
 *   1. Dataset schemas are only known at runtime, so they cannot be declared
 *      in plugin.yaml the way the catalog can.
 *   2. The CLI owns state.db and applies additive migrations to it on every
 *      open. Keeping user data out means a future manifest change can never
 *      interact with a user's rows.
 *   3. state.readTable() only reaches DECLARED tables, so raw rows are never
 *      pulled into the agent's automatic context by accident. That is the
 *      property we want: the catalog is visible to the model, the data is not.
 *
 * Every identifier that reaches SQL is generated here and validated against
 * the same rule the CLI uses. Values are always bound.
 *
 * This module is deliberately standalone — a plugin in this repo must not
 * import CLI internals.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The reserved metadata column every dataset table carries. */
export const SOURCE_LINE_COLUMN = '_source_line';

/** Where the warehouse lives, overridable for tests and odd setups. */
export function warehousePath() {
  const override = process.env.BAHULAM_DATA_CLEANROOM_DIR;
  if (override && String(override).trim()) {
    return path.join(String(override).trim(), 'warehouse.sqlite');
  }
  return path.join(os.homedir(), '.bahulam', 'data', 'data-cleanroom', 'warehouse.sqlite');
}

/** Throws rather than interpolating an unvalidated identifier. */
export function assertIdentifier(name) {
  const value = String(name ?? '');
  if (!SAFE_IDENT.test(value)) {
    throw new Error(`unsafe SQL identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function quoteIdent(name) {
  return `"${assertIdentifier(name)}"`;
}

/** Dataset tables are namespaced by catalog id so two files can share a slug. */
export function tableNameFor(datasetId, slug) {
  const safeSlug = String(slug || 'dataset').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return assertIdentifier(`dataset_${Number(datasetId)}_${safeSlug || 'data'}`);
}

export function quarantineTableNameFor(datasetId) {
  return assertIdentifier(`quarantine_${Number(datasetId)}`);
}

/**
 * Open the warehouse, creating it and its directory on first use.
 * node:sqlite is required — there is no JSON fallback, because the whole
 * point is to store typed rows, and pretending otherwise would corrupt data.
 */
export async function openWarehouse(filePath = warehousePath()) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error('openWarehouse: node:sqlite is required (Node 22.5+)');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}

export function tableExists(db, name) {
  assertIdentifier(name);
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

/**
 * Create a dataset table.
 *
 * `_source_line` is always first so every row is traceable back to the file
 * it came from, and so quarantine entries can be correlated with loaded rows.
 */
export function createDatasetTable(db, table, columns) {
  assertIdentifier(table);
  const decls = [`${SOURCE_LINE_COLUMN} INTEGER`];
  for (const column of columns) {
    decls.push(`${quoteIdent(column.column_name)} ${sqliteTypeFor(column.selected_type)}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${decls.join(', ')})`);
}

export function createQuarantineTable(db, table) {
  assertIdentifier(table);
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (`
      + 'id INTEGER PRIMARY KEY AUTOINCREMENT, '
      + 'load_run_id INTEGER, source_line INTEGER, raw_record TEXT, '
      + 'errors_json TEXT, created_at TEXT)',
  );
}

/** Map an inferred type onto a SQLite storage class. */
export function sqliteTypeFor(type) {
  switch (String(type || 'TEXT').toUpperCase()) {
    case 'INTEGER':
    case 'BOOLEAN':
      return 'INTEGER';
    case 'REAL':
      return 'REAL';
    default:
      return 'TEXT';
  }
}

export function dropDatasetTable(db, table) {
  assertIdentifier(table);
  db.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
}

/**
 * Insert rows in one transaction. All-or-nothing, so a mid-batch failure
 * cannot leave a dataset that is half the file.
 *
 * @param {Array<{sourceLine:number, values:Array<number|string|null>}>} rows
 */
export function insertRows(db, table, columns, rows) {
  assertIdentifier(table);
  const names = [SOURCE_LINE_COLUMN, ...columns.map(c => c.column_name)];
  const placeholders = names.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO ${quoteIdent(table)} (${names.map(quoteIdent).join(', ')}) VALUES (${placeholders})`,
  );
  db.exec('BEGIN');
  try {
    for (const row of rows) stmt.run(row.sourceLine, ...row.values);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
  return rows.length;
}

/**
 * Reject a query that is not a single read-only statement.
 *
 * This is a guard rail, not a sandbox: the data is local and the caller is
 * trusted-ish. But a generated tool should never be the thing that lets an
 * agent DROP a table, and a semicolon should never smuggle a second statement.
 *
 * @returns {{ok:boolean, reason?:string}}
 */
export function assertReadOnlySql(sql, allowedTables) {
  const text = String(sql ?? '').trim().replace(/;+$/, '');
  if (!text) return { ok: false, reason: 'empty SQL' };
  if (text.includes(';')) return { ok: false, reason: 'multiple statements are not allowed' };
  if (!/^(select|with)\b/i.test(text)) return { ok: false, reason: 'only SELECT/WITH queries are allowed' };
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(text)) {
    return { ok: false, reason: 'the query contains a write or schema statement' };
  }
  const allowed = new Set(allowedTables.map(t => String(t).toLowerCase()));
  const referenced = new Set();
  const re = /\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let match;
  while ((match = re.exec(text)) !== null) referenced.add(match[1].toLowerCase());
  for (const table of referenced) {
    if (!allowed.has(table)) {
      return { ok: false, reason: `query touches \"${table}\", which is not this dataset's table` };
    }
  }
  return { ok: true };
}
