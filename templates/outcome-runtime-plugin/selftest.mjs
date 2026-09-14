import { DatabaseSync } from 'node:sqlite';
import { call as createWorkItem } from './tools/create-work-item.mjs';
import { call as recordOutcome } from './tools/record-outcome.mjs';
import { call as buildOutcomeReport } from './tools/build-outcome-report.mjs';

let failures = 0;
function ok(label, cond) {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
}

const DDL = `
CREATE TABLE work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  artifact_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

function makeState() {
  const db = new DatabaseSync(':memory:');
  db.exec(DDL);
  const kv = new Map();
  const records = [];
  return {
    get(key, fallback = null) {
      return kv.has(key) ? JSON.parse(kv.get(key)) : fallback;
    },
    set(key, value) {
      kv.set(key, JSON.stringify(value));
      return value;
    },
    patch(key, value) {
      const current = this.get(key, {}) || {};
      const next = { ...current, ...value };
      this.set(key, next);
      return next;
    },
    append(stream, payload) {
      records.push({ id: records.length + 1, stream, payload, created_at: new Date(0).toISOString() });
      return records.length;
    },
    list(stream) {
      return records.filter(row => row.stream === stream);
    },
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (String(sql).trim().slice(0, 6).toUpperCase() === 'SELECT') return stmt.all(...params);
      const info = stmt.run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    close() {
      db.close();
    },
  };
}

const state = makeState();
const options = { state: Promise.resolve(state) };
try {
  const created = await createWorkItem({ title: 'Template test', objective: 'Prove the outcome loop.' }, options);
  ok('create_work_item succeeds', created.success && created.output.work_item_id === 1);
  ok('runtime_state tracks active work item', state.get('runtime_state').active_work_item_id === 1);

  const recorded = await recordOutcome({ work_item_id: 1, kind: 'artifact', summary: 'Outcome recorded.', artifact_path: 'artifacts/report.md' }, options);
  ok('record_outcome succeeds', recorded.success && recorded.output.outcome_id === 1);

  const report = await buildOutcomeReport({ work_item_id: 1 }, options);
  ok('build_outcome_report returns markdown', report.success && report.output.markdown.includes('Outcome recorded.'));
  ok('activity stream captures lifecycle', state.list('activity').length === 2);
} finally {
  state.close();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nALL OUTCOME-RUNTIME TEMPLATE SELFTESTS PASSED');
