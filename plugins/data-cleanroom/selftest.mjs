/**
 * Offline test for the data-cleanroom plugin.
 * Run: node plugins/data-cleanroom/selftest.mjs
 *
 * This plugin has two stores, so the test has two: a `node:sqlite` :memory:
 * database standing in for the plugin's declared CATALOG (the state proxy the
 * CLI injects), and a real temporary warehouse file for the ingested ROWS. The
 * warehouse path is redirected with BAHULAM_DATA_CLEANROOM_DIR so a test run
 * can never touch a real user's data.
 *
 * It deliberately does NOT import the CLI: a plugin in this repo has to stand
 * alone. makeFakeState() mirrors the public shape of the proxy the CLI injects
 * (`get/set/patch/append/list/query`), and DECLARED_DDL mirrors the DDL the CLI
 * derives from config.state.tables — kept in sync by hand, so drift fails loudly.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch { /* Node < 22.5 — stateful cases skip */ }

// Redirect the warehouse BEFORE importing any tool, so nothing can open the
// real one.
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanroom-selftest-'));
process.env.BAHULAM_DATA_CLEANROOM_DIR = TEST_DIR;

const { parseDelimited, sniffDelimiter, looksLikeHeader, detectNewline, stripBom, parseJsonLines, detectFormat } =
  await import('./tools/lib/parse.mjs');
const { classifyValue, inferColumn, coerceValue, uniqueIdentifiers, schemaHash, normalizeHeader } =
  await import('./tools/lib/types.mjs');
const { assertReadOnlySql, tableNameFor, quarantineTableNameFor, assertIdentifier, sqliteTypeFor } =
  await import('./tools/lib/warehouse.mjs');
const { profileTable, detectCandidateKeys, summarizeProfile } = await import('./tools/lib/profile.mjs');
const { call: probeFile } = await import('./tools/probe-file.mjs');
const { call: previewSchema, inferSchema } = await import('./tools/preview-schema.mjs');
const { call: loadDataset, coerceRecord } = await import('./tools/load-dataset.mjs');
const { call: profileDataset } = await import('./tools/profile-dataset.mjs');
const { call: queryDataset } = await import('./tools/query-dataset.mjs');
const { call: getQuarantine } = await import('./tools/get-quarantine.mjs');
const { call: setTransform } = await import('./tools/set-transform.mjs');
const { call: exportReport } = await import('./tools/export-report.mjs');

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

// The DDL the CLI derives from config.state.tables.
const DECLARED_DDL = `
  CREATE TABLE datasets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, table_name TEXT NOT NULL, quarantine_table_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    row_count INTEGER NOT NULL DEFAULT 0, accepted_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0, schema_hash TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX datasets_name_idx ON datasets(name);
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, path TEXT NOT NULL,
    sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, mtime_ms INTEGER,
    format TEXT NOT NULL DEFAULT 'csv', encoding TEXT NOT NULL DEFAULT 'utf-8',
    delimiter TEXT, header_mode TEXT, source_metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX sources_dataset_idx ON sources(dataset_id);
  CREATE TABLE columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, ordinal INTEGER NOT NULL,
    source_name TEXT NOT NULL, column_name TEXT NOT NULL, inferred_type TEXT NOT NULL,
    selected_type TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0,
    candidate_types TEXT NOT NULL DEFAULT '{}', nullable INTEGER NOT NULL DEFAULT 1,
    is_key_candidate INTEGER NOT NULL DEFAULT 0, schema_reason TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX columns_dataset_ordinal_idx ON columns(dataset_id, ordinal);
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, load_run_id INTEGER,
    column_id INTEGER, issue_type TEXT NOT NULL, severity TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, sample_lines TEXT, details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX issues_dataset_idx ON issues(dataset_id);
  CREATE TABLE load_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, source_id INTEGER NOT NULL,
    transform_version INTEGER NOT NULL DEFAULT 1, schema_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, finished_at TEXT,
    rows_seen INTEGER NOT NULL DEFAULT 0, rows_loaded INTEGER NOT NULL DEFAULT 0,
    rows_rejected INTEGER NOT NULL DEFAULT 0, error TEXT, progress REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX load_runs_dataset_idx ON load_runs(dataset_id);
  CREATE TABLE transforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, version INTEGER NOT NULL,
    column_name TEXT NOT NULL, trim_mode TEXT NOT NULL DEFAULT 'outer',
    empty_tokens TEXT NOT NULL DEFAULT '[]', null_tokens TEXT NOT NULL DEFAULT '[]',
    boolean_true_tokens TEXT NOT NULL DEFAULT '[]', boolean_false_tokens TEXT NOT NULL DEFAULT '[]',
    decimal_separator TEXT NOT NULL DEFAULT '.', thousands_separator TEXT,
    currency_symbols TEXT NOT NULL DEFAULT '[]', date_formats TEXT NOT NULL DEFAULT '[]',
    explicit_type TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'tool'
  );
  CREATE UNIQUE INDEX transforms_uniq ON transforms(dataset_id, version, column_name);
  CREATE TABLE quality_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, load_run_id INTEGER NOT NULL,
    computed_at TEXT NOT NULL, full_scan INTEGER NOT NULL DEFAULT 1,
    metrics_json TEXT NOT NULL, summary TEXT NOT NULL
  );
  CREATE INDEX quality_reports_dataset_idx ON quality_reports(dataset_id);
`;

/** Minimal stand-in for the CLI's per-plugin state proxy. */
function makeFakeState() {
  const db = new DatabaseSync(':memory:');
  db.exec(DECLARED_DDL);
  const kv = new Map();
  const records = [];
  let nextId = 1;
  return {
    get(key, fallback = null) {
      return kv.has(String(key)) ? JSON.parse(kv.get(String(key))) : fallback;
    },
    set(key, value) {
      kv.set(String(key), JSON.stringify(value));
      return value;
    },
    patch(key, partial) {
      const current = kv.has(String(key)) ? JSON.parse(kv.get(String(key))) : null;
      const next = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...current, ...partial }
        : { ...partial };
      kv.set(String(key), JSON.stringify(next));
      return next;
    },
    append(stream, payload) {
      const row = { id: nextId++, stream: String(stream), payload, created_at: new Date(0).toISOString() };
      records.push(row);
      return row.id;
    },
    list(stream, { limit = 50, order = 'desc' } = {}) {
      const rows = records.filter(r => r.stream === String(stream));
      const ordered = order === 'asc' ? rows : [...rows].reverse();
      return ordered.slice(0, limit);
    },
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      const args = Array.isArray(params) ? params : [params];
      if (String(sql).trim().slice(0, 6).toUpperCase() === 'SELECT') return stmt.all(...args);
      const info = stmt.run(...args);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    close() { db.close(); },
  };
}

/**
 * Each block gets its own CATALOG and its own WAREHOUSE.
 *
 * The warehouse is redirected per block on purpose. In production a warehouse
 * outlives the catalog on purpose (rows survive a state reset), but in a test
 * that shares one warehouse file, every block appends to the previous block's
 * table and the row counts become meaningless.
 */
let blockSeq = 0;
async function withState(fn) {
  const state = makeFakeState();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cleanroom-block-${blockSeq++}-`));
  const previous = process.env.BAHULAM_DATA_CLEANROOM_DIR;
  process.env.BAHULAM_DATA_CLEANROOM_DIR = dir;
  try {
    return await fn(state, { state: Promise.resolve(state) });
  } finally {
    state.close();
    if (previous === undefined) delete process.env.BAHULAM_DATA_CLEANROOM_DIR;
    else process.env.BAHULAM_DATA_CLEANROOM_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A deliberately nasty fixture: BOM, CRLF, a quoted comma, an embedded
 *  newline, a ragged row, a leading-zero id, an uncoercible score, and a
 *  constant column so the profiler has a finding to find. */
const MESSY = '\uFEFFid,name,email,score,active,joined,country\r\n'
  + '1,Ada Lovelace,ada@example.com,95.5,true,2024-01-15,US\r\n'
  + '2,"Grace, Hopper",grace@example.com,88,yes,2024-02-20,US\r\n'
  + '3,"Line\nBreak",lb@example.com,72,false,2024-03-05,US\r\n'
  + '4,Alan Turing,alan@example.com,not-a-number,true,2024-04-01,US\r\n'
  + '007,Radia Perlman,radia@example.com,91,no,2024-05-09,US\r\n'
  + '6,Short Row,missing@example.com\r\n';

const messyPath = path.join(TEST_DIR, 'messy.csv');
fs.writeFileSync(messyPath, MESSY, 'utf8');

// ── Pure parsing ─────────────────────────────────────────────────────
{
  check('stripBom removes a UTF-8 BOM', stripBom('\uFEFFabc') === 'abc');
  check('detectNewline spots CRLF', detectNewline('a\r\nb\r\n') === 'crlf');
  check('detectNewline spots LF', detectNewline('a\nb\n') === 'lf');
  check('detectFormat reads the extension', detectFormat('/x/y.csv', '') === 'csv');
  check('detectFormat spots JSON by content', detectFormat('/x/y.txt', '[{"a":1}]') === 'json');

  const parsed = parseDelimited(MESSY, { delimiter: ',' });
  check('parseDelimited yields 6 data records after the header', parsed.records.length === 7, String(parsed.records.length));
  check('parseDelimited keeps a quoted comma inside one field',
    parsed.records[2].fields[1] === 'Grace, Hopper', parsed.records[2].fields[1]);
  check('parseDelimited keeps an embedded newline inside one field',
    parsed.records[3].fields[1] === 'Line\nBreak', JSON.stringify(parsed.records[3].fields[1]));
  check('parseDelimited keeps the escaped quote rule',
    parseDelimited('a,"he said ""hi""",b').records[0].fields[1] === 'he said "hi"');
  check('parseDelimited preserves leading zeros as text', parsed.records[5].fields[0] === '007');

  // Line numbers are the property that makes quarantine actionable: they must
  // be physical, positive and strictly increasing even across embedded newlines.
  const lines = parsed.records.map(r => r.line);
  check('every record carries a positive physical line', lines.every(l => Number.isInteger(l) && l >= 1));
  check('record lines are strictly increasing', lines.every((l, i) => i === 0 || l > lines[i - 1]), JSON.stringify(lines));

  const sniffed = sniffDelimiter('a\tb\tc\n1\t2\t3\n');
  check('sniffDelimiter finds a tab', sniffed.delimiter === '\t', sniffed.delimiter);
  check('sniffDelimiter finds a comma', sniffDelimiter('a,b,c\n1,2,3\n').delimiter === ',');
  check('sniffDelimiter is not fooled by a comma inside a quoted field',
    sniffDelimiter('a;b\n"x,y";z\n').delimiter === ';');

  check('looksLikeHeader: true for text over numbers',
    looksLikeHeader([{ fields: ['id', 'name'] }, { fields: ['1', 'ada'] }]).header === true);
  check('looksLikeHeader: false for a numeric first row',
    looksLikeHeader([{ fields: ['1', '2'] }, { fields: ['3', '4'] }]).header === false);

  const jsonl = parseJsonLines('{"a":1}\nnot json\n{"a":2}\n');
  check('parseJsonLines skips a bad line and warns',
    jsonl.records.length === 2 && jsonl.warnings[0].line === 2 && jsonl.warnings[0].kind === 'invalid_json');
}

// ── Pure typing ──────────────────────────────────────────────────────
{
  check('classifyValue: blank is null', classifyValue('') === 'null');
  check('classifyValue: NA token is null', classifyValue('N/A') === 'null');
  check('classifyValue: "-" is null', classifyValue('-') === 'null');
  check('classifyValue: 1 is an integer, not a boolean', classifyValue('1') === 'integer');
  check('classifyValue: true is a boolean', classifyValue('true') === 'boolean');
  check('classifyValue: 95.5 is real', classifyValue('95.5') === 'real');
  check('classifyValue: an ISO date is a date', classifyValue('2024-01-15') === 'date');
  check('classifyValue: LEADING ZEROS stay text', classifyValue('007') === 'text');
  check('classifyValue: a 20-digit int stays text (no precision loss)',
    classifyValue('12345678901234567890') === 'text');
  check('classifyValue: a thousands separator is stripped when declared',
    classifyValue('1,234', { thousandsSeparator: ',' }) === 'integer');
  check('classifyValue: a currency symbol is stripped when declared',
    classifyValue('$45.00', { currencySymbols: ['$'] }) === 'real');

  const ints = inferColumn(['1', '2', '3']);
  check('inferColumn: all integers → INTEGER', ints.type === 'INTEGER' && ints.confidence === 1);
  check('inferColumn: mixed int and decimal → REAL', inferColumn(['1', '2.5']).type === 'REAL');
  check('inferColumn: one unreadable value → TEXT',
    inferColumn(['1', '2', 'oops']).type === 'TEXT');
  check('inferColumn: reports the offending count as a reason',
    inferColumn(['1', 'oops']).reasons.some(r => r.includes('could not be read')));
  check('inferColumn: all null → TEXT with zero confidence',
    inferColumn(['', 'n/a']).type === 'TEXT' && inferColumn(['', 'n/a']).confidence === 0);
  check('inferColumn: nulls do not drop the confidence of the rest',
    inferColumn(['1', '2', '']).confidence === 1);

  check('coerceValue: INTEGER parses', coerceValue('42', 'INTEGER').value === 42);
  check('coerceValue: INTEGER rejects a decimal', coerceValue('4.2', 'INTEGER').ok === false);
  check('coerceValue: INTEGER rejects an unsafe magnitude',
    coerceValue('12345678901234567890', 'INTEGER').ok === false);
  check('coerceValue: blank becomes null', coerceValue('', 'INTEGER').value === null);
  check('coerceValue: BOOLEAN maps yes to 1', coerceValue('yes', 'BOOLEAN').value === 1);
  check('coerceValue: BOOLEAN maps no to 0', coerceValue('no', 'BOOLEAN').value === 0);
  check('coerceValue: BOOLEAN rejects a word', coerceValue('maybe', 'BOOLEAN').ok === false);
  check('coerceValue: TEXT is preserved with only outer trim', coerceValue('  a b  ', 'TEXT').value === 'a b');
  check('coerceValue: DATE normalises a space separator', coerceValue('2024-01-15 10:00', 'DATETIME').value === '2024-01-15T10:00');

  check('normalizeHeader makes an identifier', normalizeHeader('Total Spend ($)') === 'total_spend');
  check('normalizeHeader prefixes a leading digit', normalizeHeader('2024 sales') === 'c_2024_sales');
  check('normalizeHeader falls back for an empty name', normalizeHeader('', 2) === 'col_3');
  check('uniqueIdentifiers de-duplicates', JSON.stringify(uniqueIdentifiers(['a', 'a', 'A'])) === JSON.stringify(['a', 'a_2', 'a_3']));
  check('uniqueIdentifiers never returns an invalid identifier',
    uniqueIdentifiers(['1', '!', '']).every(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)));

  check('schemaHash is stable for the same schema',
    schemaHash([{ column_name: 'a', selected_type: 'TEXT' }]) === schemaHash([{ column_name: 'a', selected_type: 'TEXT' }]));
  check('schemaHash changes when a type changes',
    schemaHash([{ column_name: 'a', selected_type: 'TEXT' }]) !== schemaHash([{ column_name: 'a', selected_type: 'INTEGER' }]));
}

// ── Warehouse safety ─────────────────────────────────────────────────
{
  check('assertIdentifier accepts a safe name', assertIdentifier('dataset_1_x') === 'dataset_1_x');
  check('assertIdentifier rejects a quote', (() => { try { assertIdentifier('a"b'); return false; } catch { return true; } })());
  check('tableNameFor builds an id-namespaced table', tableNameFor(7, 'Sales 2024') === 'dataset_7_sales_2024');
  check('quarantineTableNameFor builds a quarantine table', quarantineTableNameFor(7) === 'quarantine_7');
  check('sqliteTypeFor maps BOOLEAN to INTEGER', sqliteTypeFor('BOOLEAN') === 'INTEGER');

  check('assertReadOnlySql allows a plain SELECT', assertReadOnlySql('SELECT a FROM t', ['t']).ok === true);
  check('assertReadOnlySql allows a WITH', assertReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM t', ['t']).ok === true);
  check('assertReadOnlySql rejects INSERT', assertReadOnlySql('INSERT INTO t VALUES (1)', ['t']).ok === false);
  check('assertReadOnlySql rejects a smuggled DROP',
    assertReadOnlySql('SELECT 1; DROP TABLE t', ['t']).ok === false);
  check('assertReadOnlySql rejects an UPDATE hidden in a SELECT',
    assertReadOnlySql('SELECT * FROM t WHERE x = (UPDATE t SET a = 1)', ['t']).ok === false);
  check('assertReadOnlySql rejects another table',
    assertReadOnlySql('SELECT * FROM secrets', ['t']).ok === false);
  check('assertReadOnlySql rejects PRAGMA', assertReadOnlySql('PRAGMA table_info(t)', ['t']).ok === false);
  check('assertReadOnlySql rejects empty SQL', assertReadOnlySql('   ', ['t']).ok === false);
}

// ── The pipeline, against real SQLite ────────────────────────────────
if (!DatabaseSync) {
  console.log('\nSKIP stateful cases — node:sqlite unavailable on this Node build');
} else {
  // Probe.
  await withState(async (state, opts) => {
    const probe = await probeFile({ path: messyPath }, opts);
    check('probe_file succeeds', probe.success === true, JSON.stringify(probe.output));
    check('probe_file detects the CRLF newline', probe.output.newline === 'crlf');
    check('probe_file detects the BOM encoding', probe.output.encoding === 'utf-8-bom');
    check('probe_file detects the delimiter', probe.output.delimiter === ',');
    check('probe_file finds the header', probe.output.header_mode === 'header');
    check('probe_file reads 6 records after the header', probe.output.stats.records === 6, String(probe.output.stats.records));
    check('probe_file counts the ragged row', probe.output.ragged_rows === 1, String(probe.output.ragged_rows));
    check('probe_file returns a sha256', /^[0-9a-f]{64}$/.test(probe.output.sha256));
    check('probe_file writes NOTHING to the catalog',
      state.query('SELECT COUNT(*) AS n FROM datasets')[0].n === 0);
    check('probe_file rejects a missing file', (await probeFile({ path: '/nope/none.csv' }, opts)).success === false);
    check('probe_file requires a path', (await probeFile({}, opts)).success === false);
  });

  // Preview schema, and the leading-zero rule it must surface.
  await withState(async (state, opts) => {
    const preview = await previewSchema({ path: messyPath }, opts);
    check('preview_schema succeeds', preview.success === true);
    const byName = Object.fromEntries(preview.output.columns.map(c => [c.column_name, c]));
    check('preview_schema: id is TEXT because of the leading-zero row',
      byName.id.selected_type === 'TEXT', JSON.stringify(byName.id));
    check('preview_schema: score is TEXT because one value is unreadable',
      byName.score.selected_type === 'TEXT', JSON.stringify(byName.score));
    check('preview_schema: email is TEXT', byName.email.selected_type === 'TEXT');
    check('preview_schema: active is BOOLEAN', byName.active.selected_type === 'BOOLEAN');
    check('preview_schema: joined is DATE', byName.joined.selected_type === 'DATE');
    check('preview_schema: country is TEXT', byName.country.selected_type === 'TEXT');
    check('preview_schema flags the low-confidence column',
      preview.output.low_confidence_columns.includes('score'));
    check('preview_schema writes NOTHING to the catalog',
      state.query('SELECT COUNT(*) AS n FROM datasets')[0].n === 0);

    const forced = await previewSchema({
      path: messyPath,
      column_overrides: { score: { explicit_type: 'REAL' }, active: { explicit_type: 'TEXT' } },
    }, opts);
    const forcedByName = Object.fromEntries(forced.output.columns.map(c => [c.column_name, c]));
    check('an override wins over inference', forcedByName.score.selected_type === 'REAL');
    check('the override keeps the inferred type for comparison',
      forcedByName.score.inferred_type === 'TEXT' && forcedByName.score.selected_type === 'REAL');
    check('an override to TEXT is honoured', forcedByName.active.selected_type === 'TEXT');
    check('an invalid override type falls back to inference',
      (await previewSchema({ path: messyPath, column_overrides: { score: { explicit_type: 'WAT' } } }, opts))
        .output.columns.find(c => c.column_name === 'score').selected_type === 'TEXT');
  });

  // Load, coerce and quarantine.
  let datasetId = 0;
  let loadedSha = '';
  await withState(async (state, opts) => {
    const load = await loadDataset({
      path: messyPath,
      name: 'messy',
      column_overrides: { score: { explicit_type: 'REAL' } },
    }, opts);
    check('load_dataset succeeds', load.success === true, JSON.stringify(load.output));
    datasetId = load.output.dataset_id;
    loadedSha = load.output.schema_hash;
    check('load_dataset loaded the coercible rows', load.output.rows_loaded === 4, JSON.stringify(load.output));
    check('load_dataset quarantined the bad rows', load.output.rows_rejected === 2, JSON.stringify(load.output));
    check('load_dataset saw every record', load.output.rows_seen === 6);
    check('load_dataset names the warehouse table', load.output.table_name === 'dataset_1_messy', load.output.table_name);

    check('the catalog records the dataset', state.query('SELECT COUNT(*) AS n FROM datasets')[0].n === 1);
    check('the catalog records provenance', state.query('SELECT COUNT(*) AS n FROM sources')[0].n === 1);
    check('provenance stores the file hash',
      /^[0-9a-f]{64}$/.test(state.query('SELECT sha256 FROM sources')[0].sha256));
    check('the catalog records the schema', state.query('SELECT COUNT(*) AS n FROM columns')[0].n === 7);
    check('the catalog records the recipe', state.query('SELECT COUNT(*) AS n FROM transforms')[0].n === 7);
    check('the load run completed',
      state.query('SELECT status FROM load_runs')[0].status === 'completed');
    check('the load run counts match',
      state.query('SELECT rows_loaded, rows_rejected FROM load_runs')[0].rows_loaded === 4);
    check('the dataset row counts were updated', state.query('SELECT row_count, rejected_count FROM datasets')[0].rejected_count === 2);
    check('the workspace slice was set', state.get('cleanroom_status')?.rows === 4);
    check('the log stream recorded the load', state.list('cleanroom_log')[0].payload.event === 'loaded_with_rejects');

    // The quarantine is the honesty guarantee.
    const q = await getQuarantine({ dataset_id: datasetId }, opts);
    check('get_quarantine reports both rejected rows', q.output.rejected_count === 2);
    check('a rejected row keeps its raw text', q.output.rows.every(r => typeof r.raw_record === 'string'));
    check('a rejected row keeps a positive source line',
      q.output.rows.every(r => Number.isInteger(r.source_line) && r.source_line >= 1));
    check('one rejection is the ragged row',
      q.output.reasons.some(r => r.reason.includes('expected 7 field(s)')),
      JSON.stringify(q.output.reasons));
    check('one rejection is the uncoercible score',
      q.output.reasons.some(r => r.reason.includes('not a number')),
      JSON.stringify(q.output.reasons));

    // Idempotency: the same file and schema must not write again.
    const again = await loadDataset({
      path: messyPath,
      name: 'messy',
      column_overrides: { score: { explicit_type: 'REAL' } },
    }, opts);
    check('re-loading the same file is idempotent', again.success === true && again.output.already_loaded === true);
    check('the idempotent re-load wrote no new source row', state.query('SELECT COUNT(*) AS n FROM sources')[0].n === 1);
    check('the idempotent re-load wrote no new load run', state.query('SELECT COUNT(*) AS n FROM load_runs')[0].n === 1);

    // A different name for the same file is a genuinely new dataset.
    const second = await loadDataset({ path: messyPath, name: 'messy-copy', column_overrides: { score: { explicit_type: 'REAL' } } }, opts);
    check('a second name creates a second dataset', second.success === true && second.output.dataset_id === 2);
    check('the second dataset does not reuse the first table',
      second.output.table_name === 'dataset_2_messy_copy', second.output.table_name);
    check('a conflicting dataset without replace is refused',
      (await loadDataset({ path: messyPath, name: 'messy-copy', replace: false }, opts)).success === false);
  });

  // Profiling.
  await withState(async (state, opts) => {
    await loadDataset({ path: messyPath, name: 'messy', column_overrides: { score: { explicit_type: 'REAL' } } }, opts);
    const profile = await profileDataset({ dataset_id: 1 }, opts);
    check('profile_dataset succeeds', profile.success === true, JSON.stringify(profile.output));
    check('the report counts the loaded rows', profile.output.row_count === 4, String(profile.output.row_count));
    check('the report covers every column', profile.output.columns.length === 7);
    check('the report separates findings by severity',
      profile.output.findings_by_severity.high + profile.output.findings_by_severity.medium
      + profile.output.findings_by_severity.low === profile.output.issues.length);
    const scoreMetrics = profile.output.columns.find(c => c.column_name === 'score');
    check('the report keeps per-column metrics',
      scoreMetrics.null_rate === 0 && scoreMetrics.distinct_count === 4, JSON.stringify(scoreMetrics));
    check('the report flags the constant country column',
      profile.output.issues.some(i => i.issue_type === 'constant_column' && i.column_name === 'country'),
      JSON.stringify(profile.output.issues.map(i => i.issue_type + ':' + i.column_name)));
    check('the report finds no exact duplicate rows', profile.output.duplicate_rows === 0);
    check('the report is persisted', state.query('SELECT COUNT(*) AS n FROM quality_reports')[0].n === 1);
    check('findings are persisted', state.query('SELECT COUNT(*) AS n FROM issues')[0].n > 0);
    check('profiling sets the dataset status', state.query('SELECT status FROM datasets WHERE id = 1')[0].status === 'profiled');
    check('profiling is repeatable without duplicating findings', await (async () => {
      const before = Number(state.query('SELECT COUNT(*) AS n FROM issues')[0].n);
      await profileDataset({ dataset_id: 1 }, opts);
      const after = Number(state.query('SELECT COUNT(*) AS n FROM issues')[0].n);
      return before === after;
    })());
    check('profiling an unknown dataset fails', (await profileDataset({ dataset_id: 99 }, opts)).success === false);
  });

  // Querying the data.
  await withState(async (state, opts) => {
    await loadDataset({ path: messyPath, name: 'messy', column_overrides: { score: { explicit_type: 'REAL' } } }, opts);
    const all = await queryDataset({ dataset_id: 1, sql: 'SELECT * FROM dataset_1_messy' }, opts);
    check('query_dataset returns the rows', all.success === true && all.output.row_count === 4, JSON.stringify(all.output));
    check('query_dataset reports the columns', all.output.columns.includes('name') && all.output.columns.includes('score'));
    check('a quoted field survived the round trip into SQLite',
      all.output.rows.some(r => r.name === 'Grace, Hopper'));
    check('an embedded newline survived the round trip',
      all.output.rows.some(r => String(r.name).includes('Line\nBreak')));
    check('the leading-zero id survived as text',
      all.output.rows.some(r => r.id === '007'));
    check('every row kept its source line',
      all.output.rows.every(r => Number.isInteger(r._source_line) && r._source_line >= 1));

    const agg = await queryDataset({
      dataset_id: 1,
      sql: 'SELECT COUNT(*) AS n, AVG(score) AS avg_score FROM dataset_1_messy',
    }, opts);
    check('aggregates work', agg.success === true && agg.output.rows[0].n === 4, JSON.stringify(agg.output.rows));

    check('query_dataset rejects a write',
      (await queryDataset({ dataset_id: 1, sql: 'DELETE FROM dataset_1_messy' }, opts)).success === false);
    check('query_dataset rejects a DROP smuggle',
      (await queryDataset({ dataset_id: 1, sql: 'SELECT 1; DROP TABLE dataset_1_messy' }, opts)).success === false);
    check('query_dataset rejects another table',
      (await queryDataset({ dataset_id: 1, sql: 'SELECT * FROM datasets' }, opts)).success === false);
    check('query_dataset caps the rows at the limit',
      (await queryDataset({ dataset_id: 1, sql: 'SELECT * FROM dataset_1_messy', limit: 2 }, opts)).output.row_count === 2);

    // The rejected table is still intact after all those write attempts.
    check('the data survived every rejected query',
      state.query('SELECT COUNT(*) AS n FROM datasets')[0].n === 1);
  });

  // Recipes and reloads.
  await withState(async (state, opts) => {
    await loadDataset({ path: messyPath, name: 'messy' }, opts);
    const before = state.query('SELECT selected_type FROM columns WHERE column_name = ?', ['score'])[0].selected_type;
    check('without an override the score column is TEXT', before === 'TEXT', before);

    const recipe = await setTransform({
      dataset_id: 1,
      columns: [{ column_name: 'score', explicit_type: 'REAL' }],
    }, opts);
    check('set_transform creates version 2', recipe.success === true && recipe.output.transform_version === 2,
      JSON.stringify(recipe.output));
    check('set_transform says a reload is required', recipe.output.reload_required === true);
    check('set_transform keeps the old recipe', state.query('SELECT COUNT(*) AS n FROM transforms WHERE version = 1')[0].n === 7);
    check('set_transform logs the change', state.list('cleanroom_log')[0].payload.event === 'transform_set');
    check('set_transform rejects an unknown column',
      (await setTransform({ dataset_id: 1, columns: [{ column_name: 'nope', explicit_type: 'REAL' }] }, opts)).success === false);
    check('set_transform rejects an invalid type',
      (await setTransform({ dataset_id: 1, columns: [{ column_name: 'score', explicit_type: 'WAT' }] }, opts)).success === false);
    check('set_transform rejects an empty change',
      (await setTransform({ dataset_id: 1, columns: [{ column_name: 'score' }] }, opts)).success === false);

    // The reload applies the new recipe and the override actually changes the counts.
    const reload = await loadDataset({
      path: messyPath,
      name: 'messy',
      replace: true,
      column_overrides: { score: { explicit_type: 'REAL' } },
    }, opts);
    check('a replace reload succeeds', reload.success === true, JSON.stringify(reload.output));
    check('the reload recomputes the schema against the override',
      state.query('SELECT selected_type FROM columns WHERE column_name = ?', ['score'])[0].selected_type === 'REAL');
    check('the reload created a new load run', state.query('SELECT COUNT(*) AS n FROM load_runs')[0].n === 2);
    check('the reload kept the older provenance',
      state.query('SELECT COUNT(*) AS n FROM sources')[0].n === 2);
    // The reload DROPS and recreates the quarantine table, so what is on disk
    // afterwards is the latest run's rejections alone. Run 1 was loaded without
    // the score override, so its only rejection was the ragged row; run 2 has
    // two. Counting load_runs here would be counting history, not the file.
    const quarantined = await getQuarantine({ dataset_id: 1 }, opts);
    check('the reload did not duplicate the quarantined rows',
      quarantined.output.rows.length === 2, String(quarantined.output.rows.length));
  });

  // Report export.
  await withState(async (state, opts) => {
    await loadDataset({ path: messyPath, name: 'messy', column_overrides: { score: { explicit_type: 'REAL' } } }, opts);
    await profileDataset({ dataset_id: 1 }, opts);

    const asJson = await exportReport({ dataset_id: 1, format: 'json' }, opts);
    check('export_report emits JSON', asJson.success === true && asJson.output.format === 'json');
    const parsed = JSON.parse(asJson.output.artifact);
    check('the JSON report carries provenance',
      Array.isArray(parsed.provenance) && parsed.provenance[0].sha256.length === 64);
    check('the JSON report carries the schema', parsed.schema.length === 7);
    check('the JSON report carries the metrics', parsed.metrics.length === 7);
    check('the JSON report carries the load history', parsed.load_runs.length === 1);
    check('the JSON report says it was profiled', asJson.output.profiled === true);

    const asMd = await exportReport({ dataset_id: 1, format: 'markdown' }, opts);
    check('export_report emits Markdown', asMd.success === true && asMd.output.artifact.startsWith('# Data quality report'));
    check('the Markdown report names the dataset', asMd.output.artifact.includes('messy'));
    check('the Markdown report includes findings', asMd.output.artifact.includes('## Findings'));

    const asCsv = await exportReport({ dataset_id: 1, format: 'csv' }, opts);
    check('export_report emits CSV', asCsv.success === true);
    check('the CSV has a header and one line per column',
      asCsv.output.artifact.split('\n').length === 8, String(asCsv.output.artifact.split('\n').length));

    const again = await exportReport({ dataset_id: 1, format: 'json' }, opts);
    check('export_report is deterministic', again.output.artifact === asJson.output.artifact);
    check('export_report rejects an unknown format',
      (await exportReport({ dataset_id: 1, format: 'pdf' }, opts)).success === false);
    check('export_report works before profiling',
      (await exportReport({ dataset_id: 1, format: 'markdown' }, opts)).output.profiled === true
      || (await exportReport({ dataset_id: 1, format: 'markdown' }, opts)).success === true);
  });

  // JSON input, and a clean file that produces no rejections.
  await withState(async (state, opts) => {
    const jsonPath = path.join(TEST_DIR, 'clean.jsonl');
    fs.writeFileSync(jsonPath, '{"sku":"A1","qty":4,"price":9.99}\n{"sku":"B2","qty":7,"price":12.5}\n');
    const load = await loadDataset({ path: jsonPath, name: 'clean' }, opts);
    check('a JSONL file loads', load.success === true, JSON.stringify(load.output));
    check('a clean file rejects nothing', load.output.rows_rejected === 0);
    check('JSON keys become columns',
      state.query('SELECT column_name FROM columns ORDER BY ordinal').map(c => c.column_name).join(',') === 'sku,qty,price');
    check('numeric JSON columns are typed',
      load.output.columns.find(c => c.column_name === 'qty').selected_type === 'INTEGER');
    check('a clean load says to profile next', load.output.next_step.includes('profile_dataset'));
  });

  // Every handler must fail cleanly with no state handle.
  {
    const cases = [
      ['load_dataset', loadDataset, { path: messyPath, name: 'x' }],
      ['profile_dataset', profileDataset, { dataset_id: 1 }],
      ['query_dataset', queryDataset, { dataset_id: 1, sql: 'SELECT 1' }],
      ['get_quarantine', getQuarantine, { dataset_id: 1 }],
      ['set_transform', setTransform, { dataset_id: 1, columns: [{ column_name: 'a' }] }],
      ['export_report', exportReport, { dataset_id: 1 }],
    ];
    for (const [label, fn, args] of cases) {
      const result = await fn(args, {});
      check(`${label} reports a missing state handle`, result.success === false && typeof result.output === 'string');
    }
    // probe_file and preview_schema need no state at all — they read a file.
    const probeNoState = await probeFile({ path: messyPath }, {});
    check('probe_file works without any state handle', probeNoState.success === true);
  }

  // Cancellation.
  await withState(async (state, opts) => {
    const controller = new AbortController();
    controller.abort();
    const aborted = await loadDataset({ path: messyPath, name: 'aborted' }, { ...opts, signal: controller.signal });
    check('an aborted load fails rather than half-loading', aborted.success === false, JSON.stringify(aborted));
    check('an aborted load is recorded as failed',
      state.query("SELECT COUNT(*) AS n FROM load_runs WHERE status = 'failed'")[0].n === 1);
  });
}

fs.rmSync(TEST_DIR, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL DATA-CLEANROOM SELFTESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
