import { DatabaseSync } from 'node:sqlite';
import { initialize } from '../core/store.mjs';
import { Research } from '../core/research.mjs';

export function state(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const api = {
    db,
    query(sql, args = []) { const statement = db.prepare(sql); return /^\s*(SELECT|PRAGMA)/i.test(sql) ? statement.all(...args) : statement.run(...args); },
    getConfig(key) { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || null; },
    setConfig(key, value) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); },
    close() { db.close(); }
  };
  initialize(api); return api;
}
export function app(overrides = {}) {
  return { name: 'Test idea', brief: 'Two people cannot see what is finished during a school run.', audiences: ['Parents'], hypotheses: [{ id: 'H1', statement: 'Coordination failures cause missed departures.' }], criteria: { direct: 1, contexts: 1, families: 1, consequences: 1, months: 24 }, ...overrides };
}
export function setup(connectors = {}, filename) {
  const db = state(filename), service = new Research(db, { key: () => 'test-key', ...connectors });
  const idea = service.saveApp({ config: app() });
  const run = service.createRun({ app_id: idea.id, budgets: { queries: 6, documents: 10, minutes: 10 }, queries: ['pain', 'alternatives', 'contrary'].map(intent => ({ query: `Parents ${intent}`, audience: 'Parents', intent })) });
  return { db, service, idea, run };
}
export const quote = 'We missed the train because neither of us knew who had packed the bags.';
export function source(service, run, overrides = {}) {
  return service.importSource({ run_id: run.id, url: 'https://example.com/discussion', title: 'A real-world experience fixture', content: `The following is a test fixture. ${quote} We now send messages after each step.`, family: 'community', published_at: new Date().toISOString().slice(0, 10), provenance_note: 'Test fixture only', ...overrides });
}
export function candidate(service, run, src, overrides = {}) {
  return service.recordEvidence({ run_id: run.id, source_id: src.id, quote, audience: 'Parents', hypothesis_ids: ['H1'], relevance: 'direct', direction: 'supports', unprompted: 'yes', rationale: 'The source describes a shared coordination failure.', consequence: 'Missed train', ...overrides });
}
