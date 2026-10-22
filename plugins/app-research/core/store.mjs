import { randomUUID } from 'node:crypto';

export const tables = ['apps', 'runs', 'sources', 'evidence', 'reviews', 'artifacts'];
export const now = () => new Date().toISOString();
export const id = () => randomUUID();

// Also declared in plugin.yaml. IDs are globally unique; all child reads are scoped.
export function initialize(state) {
  for (const name of tables) {
    state.query(`CREATE TABLE IF NOT EXISTS research_${name} (id TEXT PRIMARY KEY, app_id TEXT NOT NULL, run_id TEXT NOT NULL, data TEXT NOT NULL)`);
    state.query(`CREATE INDEX IF NOT EXISTS research_${name}_scope ON research_${name}(app_id, run_id)`);
  }
}

export class Store {
  constructor(state) { this.state = state; }
  table(name) {
    if (!tables.includes(name)) throw new Error('Unknown record type');
    return `research_${name}`;
  }
  get(name, key) {
    const row = this.state.query(`SELECT data FROM ${this.table(name)} WHERE id = ?`, [key])[0];
    if (!row) throw new Error(`${name} record not found`);
    return JSON.parse(row.data);
  }
  list(name, { app_id, run_id } = {}) {
    const clauses = [], params = [];
    if (app_id) { clauses.push('app_id = ?'); params.push(app_id); }
    if (run_id) { clauses.push('run_id = ?'); params.push(run_id); }
    return this.state.query(`SELECT data FROM ${this.table(name)}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY rowid`, params).map(r => JSON.parse(r.data));
  }
  put(name, record) {
    this.state.query(`INSERT INTO ${this.table(name)} (id, app_id, run_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [record.id, record.app_id || record.id, record.run_id || '', JSON.stringify(record)]);
    return record;
  }
  transaction(fn) {
    this.state.query('BEGIN IMMEDIATE');
    try { const value = fn(); this.state.query('COMMIT'); return value; }
    catch (error) { this.state.query('ROLLBACK'); throw error; }
  }
  mutateRun(key, fn) {
    return this.transaction(() => {
      const record = this.get('runs', key);
      fn(record);
      record.updated_at = now();
      return this.put('runs', record);
    });
  }
  child(name, key, runId) {
    const record = this.get(name, key);
    if (record.run_id !== runId) throw new Error('Record does not belong to this run');
    return record;
  }
}
