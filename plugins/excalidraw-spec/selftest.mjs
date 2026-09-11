/**
 * Offline test for the excalidraw-spec plugin.
 * Run: node plugins/excalidraw-spec/selftest.mjs
 *
 * The plugin has two halves, so the test has two: pure functions (parsing,
 * graph building, layout, scene emission) exercised directly, and the full
 * pipeline exercised against a REAL temporary repository on disk and a
 * :memory: catalog standing in for the state proxy the CLI injects.
 *
 * It deliberately does NOT import the CLI: a plugin in this repo has to stand
 * alone. DECLARED_DDL mirrors the DDL the CLI derives from config.state.tables
 * — kept in sync by hand, so drift fails loudly.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch { /* Node < 22.5 — stateful cases skip */ }

const {
  extractImports, hash32, isBuiltinModule, languageOf, packageNameOf, resolveImport,
  walkRepository, DEFAULT_SKIP_DIRS,
} = await import('./tools/lib/scan.mjs');
const {
  ROOT_KEY, buildEdges, buildNodes, classifyRole, computeLevels, externalsFor, labelForKey,
  languagesFor, layout, nodeKeyFor, sizeFor,
} = await import('./tools/lib/graph.mjs');
const { KIND_STYLE, buildScene, toMarkdown, toMermaid } = await import('./tools/lib/scene.mjs');
const { call: scanRepository } = await import('./tools/scan-repository.mjs');
const { call: annotateArchitecture, KINDS } = await import('./tools/annotate-architecture.mjs');
const { call: arrangeDiagram } = await import('./tools/arrange-diagram.mjs');
const { call: exportDiagram, FORMATS } = await import('./tools/export-diagram.mjs');
const { call: getArchitecture } = await import('./tools/get-architecture.mjs');

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

// ── A real repository on disk, so the scanner is tested against a filesystem
//    and not against a mock of one. ────────────────────────────────────────
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-spec-'));

function write(rel, body) {
  const abs = path.join(FIXTURE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
}

write('package.json', JSON.stringify({
  name: 'fixture-repo',
  main: 'src/main.mjs',
  dependencies: { express: '^4.0.0' },
}));
write('src/main.mjs', [
  "import express from 'express';",
  "import { start } from './core/agent.mjs';",
  'export function main() { return start(express); }',
].join('\n'));
write('src/core/agent.mjs', [
  "import { log } from '../util/log.mjs';",
  "import { createRequire } from 'node:module';",
  'export function start(x) { log(x); return 1; }',
].join('\n'));
write('src/core/loop.mjs', [
  "import { start } from './agent.mjs';",
  'export const loop = () => start(1);',
].join('\n'));
write('src/util/log.mjs', 'export function log(m) { return String(m); }\n');
write('src/ui/panel.mjs', [
  "import { start } from '../core/agent.mjs';",
  'export const panel = () => start(2);',
].join('\n'));
write('lib/worker.py', [
  'import os',
  'from lib.helpers import helper',
  'def run(): return helper()',
].join('\n'));
write('lib/helpers.py', 'def helper(): return 1\n');
// Noise the scanner must ignore.
write('README.md', '# not source\n');
write('node_modules/left-pad/index.js', "module.exports = require('./nope');\n");
write('dist/bundle.js', "import '../src/main.mjs';\n");
write('src/notes.txt', 'not source either\n');

// The DDL the CLI derives from config.state.tables.
const DECLARED_DDL = `
  CREATE TABLE repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, root_path TEXT NOT NULL,
    root_label TEXT NOT NULL, file_count INTEGER NOT NULL DEFAULT 0,
    source_file_count INTEGER NOT NULL DEFAULT 0, total_loc INTEGER NOT NULL DEFAULT 0,
    languages TEXT NOT NULL DEFAULT '{}', entry_points TEXT NOT NULL DEFAULT '[]',
    skipped_count INTEGER NOT NULL DEFAULT 0, scanned_at TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX repos_name_idx ON repos(name);
  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, node_key TEXT NOT NULL,
    label TEXT NOT NULL, detail TEXT, kind TEXT NOT NULL DEFAULT 'module', layer TEXT,
    layer_index INTEGER NOT NULL DEFAULT 0, source_path TEXT NOT NULL,
    file_count INTEGER NOT NULL DEFAULT 0, loc INTEGER NOT NULL DEFAULT 0,
    languages TEXT NOT NULL DEFAULT '[]', external_deps TEXT NOT NULL DEFAULT '[]',
    is_entry INTEGER NOT NULL DEFAULT 0, is_external INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX nodes_key_idx ON nodes(repo_id, node_key);
  CREATE TABLE edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, from_key TEXT NOT NULL,
    to_key TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'import', label TEXT,
    weight INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX edges_pair_idx ON edges(repo_id, from_key, to_key);
  CREATE TABLE exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, format TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'layered', node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0, element_count INTEGER NOT NULL DEFAULT 0,
    byte_size INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
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

async function withState(fn) {
  const state = makeFakeState();
  try {
    return await fn(state, { state: Promise.resolve(state) });
  } finally {
    state.close();
  }
}

// ── Import extraction ────────────────────────────────────────────────
{
  const js = extractImports([
    "import a from './a.mjs';",
    "import './side-effect.mjs';",
    "export { b } from './b.mjs';",
    "const c = require('./c.cjs');",
    "const d = await import('./d.mjs');",
    "import e from 'express';",
  ].join('\n'), 'javascript');
  check('extractImports reads a default import', js.includes('./a.mjs'));
  check('extractImports reads a side-effect import', js.includes('./side-effect.mjs'));
  check('extractImports reads a re-export', js.includes('./b.mjs'));
  check('extractImports reads require()', js.includes('./c.cjs'));
  check('extractImports reads dynamic import()', js.includes('./d.mjs'));
  check('extractImports reads a bare package', js.includes('express'));
  check('extractImports does not invent imports from prose',
    extractImports('// we should import the config later\nconst x = 1;', 'javascript').length === 0);
  check('extractImports de-duplicates',
    extractImports("import a from './a';\nimport b from './a';", 'javascript').length === 1);

  const py = extractImports('import os\nfrom lib.helpers import helper\n', 'python');
  check('extractImports reads a python import', py.includes('os'));
  check('extractImports reads a python from-import', py.includes('lib.helpers'));

  const go = extractImports([
    'package main',
    'import (',
    '\t"fmt"',
    '\t"github.com/acme/thing"',
    ')',
    'func main() { fmt.Println(1) }',
  ].join('\n'), 'go');
  check('extractImports reads a go import block', go.includes('github.com/acme/thing'));
  check('extractImports reads a go stdlib import', go.includes('fmt'));

  check('extractImports returns nothing for an unknown language',
    extractImports('anything', 'cobol').length === 0);
}

// ── Specifier classification ─────────────────────────────────────────
{
  check('isBuiltinModule catches a node: prefix', isBuiltinModule('node:fs') === true);
  check('isBuiltinModule catches a bare js builtin', isBuiltinModule('path') === true);
  check('isBuiltinModule catches a python builtin', isBuiltinModule('sqlite3') === true);
  check('isBuiltinModule leaves a real package alone', isBuiltinModule('express') === false);
  check('isBuiltinModule leaves a go module path alone', isBuiltinModule('github.com/acme/thing') === false);
  // Dotted stdlib paths are the case that a naive check misses, and they made
  // the dependency inventory read as though the project had chosen `urllib`.
  check('isBuiltinModule catches a dotted python stdlib path', isBuiltinModule('urllib.parse') === true);
  check('isBuiltinModule catches a nested python stdlib path', isBuiltinModule('concurrent.futures') === true);
  check('isBuiltinModule catches a dotted os path', isBuiltinModule('os.path') === true);
  check('isBuiltinModule leaves a slashed package subpath alone', isBuiltinModule('lodash/fp') === false);
  check('isBuiltinModule leaves a scoped package alone', isBuiltinModule('@scope/pkg') === false);

  check('packageNameOf keeps a scope', packageNameOf('@acme/ui/button', 'javascript') === '@acme/ui');
  check('packageNameOf takes the head of a subpath', packageNameOf('lodash/fp', 'javascript') === 'lodash');
  check('packageNameOf splits a python dotted path', packageNameOf('lib.helpers', 'python') === 'lib');
}

// ── Determinism primitives ───────────────────────────────────────────
{
  check('hash32 is stable', hash32('src/core') === hash32('src/core'));
  check('hash32 separates different input', hash32('src/core') !== hash32('src/util'));
  check('hash32 returns a 32-bit unsigned int',
    hash32('x') >= 0 && hash32('x') <= 0xFFFFFFFF && Number.isInteger(hash32('x')));
}

// ── Grouping and labelling ───────────────────────────────────────────
{
  check('nodeKeyFor groups at the given depth', nodeKeyFor('src/core/agent.mjs', 2) === 'src/core');
  check('nodeKeyFor stops at the depth asked for', nodeKeyFor('src/core/deep/file.mjs', 2) === 'src/core');
  check('nodeKeyFor shallower than depth keeps the directory', nodeKeyFor('src/main.mjs', 2) === 'src');
  check('nodeKeyFor puts a root file in the root bucket', nodeKeyFor('index.mjs', 2) === ROOT_KEY);
  check('nodeKeyFor handles windows separators', nodeKeyFor('src\\core\\a.mjs', 2) === 'src/core');

  check('labelForKey titles a path segment', labelForKey('src/core') === 'Core');
  check('labelForKey turns hyphens into words', labelForKey('agent-loop') === 'Agent Loop');
  check('labelForKey names the root bucket', labelForKey(ROOT_KEY) === '(root)');

  check('languageOf maps an extension', languageOf('a/b.py') === 'python');
  check('languageOf returns null for non-source', languageOf('README.md') === null);
}

// ── Resolution ───────────────────────────────────────────────────────
{
  const known = new Set(['src/main.mjs', 'src/core/agent.mjs', 'src/core/index.mjs', 'lib/helpers.py']);
  check('resolveImport resolves a relative path',
    resolveImport('./core/agent.mjs', 'src/main.mjs', known, 'javascript') === 'src/core/agent.mjs');
  check('resolveImport walks up',
    resolveImport('../main.mjs', 'src/core/agent.mjs', known, 'javascript') === 'src/main.mjs');
  check('resolveImport falls back to index',
    resolveImport('./core', 'src/main.mjs', known, 'javascript') === 'src/core/index.mjs');
  check('resolveImport resolves a python dotted path',
    resolveImport('lib.helpers', 'lib/worker.py', known, 'python') === 'lib/helpers.py');
  check('resolveImport returns null for a package',
    resolveImport('express', 'src/main.mjs', known, 'javascript') === null);
  check('resolveImport returns null for a missing relative path',
    resolveImport('./nope.mjs', 'src/main.mjs', known, 'javascript') === null);
}

// ── Graph building, on a synthetic file list ──────────────────────────
{
  const files = [
    { rel: 'src/main.mjs', language: 'javascript', loc: 10, bytes: 100, imports: ['./core/agent.mjs', 'express'] },
    { rel: 'src/core/agent.mjs', language: 'javascript', loc: 20, bytes: 200, imports: ['../util/log.mjs', 'node:fs'] },
    { rel: 'src/util/log.mjs', language: 'javascript', loc: 5, bytes: 50, imports: [] },
    { rel: 'src/ui/panel.mjs', language: 'javascript', loc: 8, bytes: 80, imports: ['../core/agent.mjs'] },
  ];
  const nodes = buildNodes(files, { groupDepth: 2, manifestEntries: ['src/main.mjs'] });
  const byKey = Object.fromEntries(nodes.map(n => [n.node_key, n]));

  check('buildNodes groups files into boxes', nodes.length === 4, nodes.map(n => n.node_key).join(','));
  check('buildNodes counts files per box', byKey['src/core'].file_count === 1);
  check('buildNodes sums loc per box', byKey['src/core'].loc === 20);
  check('buildNodes records languages', languagesFor(byKey['src/core'])[0].name === 'javascript');
  check('buildNodes marks a manifest entry point', byKey.src.is_entry === 1);
  check('buildNodes types an entry box as entry', byKey.src.kind === 'entry');
  check('buildNodes leaves a plain box as module', byKey['src/util'].kind === 'module');
  check('buildNodes labels boxes', byKey['src/util'].label === 'Util');
  check('buildNodes is name-sorted', JSON.stringify(nodes.map(n => n.node_key))
    === JSON.stringify(['src', 'src/core', 'src/ui', 'src/util']));

  const { edges, externalByKey } = buildEdges(files, nodes, { groupDepth: 2 });
  const find = (a, b) => edges.find(e => e.from_key === a && e.to_key === b);
  check('buildEdges finds a dependency', Boolean(find('src', 'src/core')));
  check('buildEdges finds a deeper dependency', Boolean(find('src/core', 'src/util')));
  check('buildEdges finds a dependency into core', Boolean(find('src/ui', 'src/core')));
  check('buildEdges weights an edge', find('src', 'src/core').weight === 1);
  check('buildEdges never emits a self-edge',
    edges.every(e => e.from_key !== e.to_key));
  check('buildEdges rolls up an external package',
    externalsFor('src', externalByKey).some(d => d.name === 'express'));
  check('buildEdges excludes builtins from externals',
    externalsFor('src/core', externalByKey).every(d => d.name !== 'node:fs'));
}

// ── Levels, layout, sizing ───────────────────────────────────────────
{
  const nodes = ['a', 'b', 'c'].map(k => ({
    node_key: k, label: k.toUpperCase(), detail: null, kind: 'module', layer: null,
    layer_index: 0, source_path: k, file_count: 1, loc: 1, languages: [],
    external_deps: [], is_entry: 0, is_external: 0, sort_order: 0, x: 0, y: 0, width: 0, height: 0,
  }));
  const edges = [
    { from_key: 'a', to_key: 'b', weight: 1, kind: 'import', label: null },
    { from_key: 'b', to_key: 'c', weight: 1, kind: 'import', label: null },
  ];
  const levels = computeLevels(nodes, edges);
  check('computeLevels starts a source at zero', levels.get('a') === 0);
  check('computeLevels pushes a dependency right', levels.get('b') === 1);
  check('computeLevels follows a chain', levels.get('c') === 2);

  // A cycle must not hang the layout. Real repositories have them.
  const cyclic = computeLevels(nodes, [...edges, { from_key: 'c', to_key: 'a', weight: 1 }]);
  check('computeLevels survives an import cycle',
    Number.isInteger(cyclic.get('a')) && Number.isInteger(cyclic.get('c')));

  const one = layout(nodes, edges, { layout: 'layered' });
  const two = layout(nodes, edges, { layout: 'layered' });
  check('layout is deterministic', JSON.stringify(one) === JSON.stringify(two));
  check('layout gives every node a position', one.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  check('layout orders a dependency to the right',
    one.find(n => n.node_key === 'b').x > one.find(n => n.node_key === 'a').x);
  check('layout starts at a margin, not at zero',
    Math.min(...one.map(n => n.x)) === 40 && Math.min(...one.map(n => n.y)) === 40);

  const stacked = one.filter(n => n.level === 0);
  check('layout stacks within a column without overlap',
    stacked.length < 2 || stacked[0].y + stacked[0].height <= stacked[1].y);

  const vertical = layout(nodes, edges, { layout: 'layered', direction: 'vertical' });
  check('layout honours a vertical direction',
    vertical.find(n => n.node_key === 'b').y > vertical.find(n => n.node_key === 'a').y);

  const grid = layout(nodes, edges, { layout: 'grid' });
  check('grid layout places every node', grid.length === 3);

  const stored = layout(nodes, edges, { layout: 'layered', levels: new Map([['a', 0], ['b', 0], ['c', 5]]) });
  check('layout obeys a stored arrangement over a recomputed one',
    stored.find(n => n.node_key === 'c').level === 5);

  check('sizeFor keeps a floor width', sizeFor({ label: 'X', node_key: 'x' }).width >= 180);
  check('sizeFor grows for a long label', sizeFor({ label: 'A Very Long Box Title Indeed', node_key: 'x' }).width
    > sizeFor({ label: 'X', node_key: 'x' }).width);
  check('sizeFor caps the width', sizeFor({ label: 'A'.repeat(400), node_key: 'x' }).width <= 420);
  check('sizeFor is taller when there is a detail line',
    sizeFor({ label: 'X', detail: 'd', node_key: 'x' }).height > sizeFor({ label: 'X', node_key: 'x' }).height);
}

// ── Role classification ──────────────────────────────────────────────
// Tested directly: a five-node fixture cannot produce the fan-in this rule
// needs, and a threshold that is never exercised is a threshold that rots.
{
  check('classifyRole: heavily depended on, depends on little → foundation',
    classifyRole(5, 1) === 'foundation');
  check('classifyRole: at the fan-in boundary → foundation', classifyRole(3, 2) === 'foundation');
  check('classifyRole: just under the boundary → internal', classifyRole(2, 2) === 'internal');
  check('classifyRole: depends on much, nothing depends on it → top-level',
    classifyRole(0, 4) === 'top-level');
  check('classifyRole: a busy hub that is also imported → internal',
    classifyRole(4, 4) === 'internal');
  check('classifyRole: an isolated box → internal', classifyRole(0, 0) === 'internal');
  check('classifyRole: survives missing counts', classifyRole(undefined, undefined) === 'internal');
}

// ── Scene emission ───────────────────────────────────────────────────
{
  const repo = { name: 'demo', root_path: '/demo', id: 1, file_count: 2, total_loc: 30, scanned_at: 'now' };
  const nodes = [
    { node_key: 'src', label: 'Src', detail: 'the entry', kind: 'entry', layer: 'App', layer_index: 0,
      source_path: 'src', file_count: 1, loc: 10, languages: [], external_deps: [],
      is_entry: 1, is_external: 0, sort_order: 0, x: 40, y: 40, width: 200, height: 84 },
    { node_key: 'src/core', label: 'Core', detail: null, kind: 'module', layer: 'App', layer_index: 1,
      source_path: 'src/core', file_count: 1, loc: 20, languages: [], external_deps: [],
      is_entry: 0, is_external: 0, sort_order: 1, x: 340, y: 40, width: 200, height: 84 },
  ];
  const edges = [{ from_key: 'src', to_key: 'src/core', weight: 7, kind: 'import', label: null }];

  const { document, elementCount } = buildScene(repo, nodes, edges, {});
  check('buildScene emits a rectangle per box', document.elements.filter(e => e.type === 'rectangle').length === 2);
  check('buildScene emits a text element per box', document.elements.filter(e => e.type === 'text').length === 2);
  check('buildScene emits an arrow per edge', document.elements.filter(e => e.type === 'arrow').length === 1);
  check('buildScene reports its element count', elementCount === document.elements.length && elementCount === 5);
  check('buildScene writes the excalidraw header',
    document.type === 'excalidraw' && document.version === 2 && document.source.includes('excalidraw-spec'));
  check('buildScene binds the text to its container',
    document.elements.find(e => e.type === 'text').containerId
    === document.elements.find(e => e.type === 'rectangle').id);

  const rect = document.elements.find(e => e.type === 'rectangle');
  check('a rectangle declares its bound text', rect.boundElements.some(b => b.type === 'text'));
  check('a rectangle declares its bound arrow', rect.boundElements.some(b => b.type === 'arrow'));

  const arrow = document.elements.find(e => e.type === 'arrow');
  check('an arrow binds to both boxes',
    Boolean(arrow.startBinding.elementId) && Boolean(arrow.endBinding.elementId)
    && arrow.startBinding.elementId !== arrow.endBinding.elementId);
  check('an arrow has points relative to its own origin',
    Array.isArray(arrow.points) && arrow.points[0][0] === 0 && arrow.points[0][1] === 0);
  check('an arrow ends in a head', arrow.endArrowhead === 'arrow');

  // Excalidraw will not load an element that is missing required fields.
  const REQUIRED = ['id', 'type', 'x', 'y', 'width', 'height', 'angle', 'strokeColor',
    'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity',
    'groupIds', 'seed', 'version', 'versionNonce', 'isDeleted', 'updated'];
  check('every element carries the required excalidraw fields',
    document.elements.every(el => REQUIRED.every(field => el[field] !== undefined)),
    document.elements.filter(el => REQUIRED.some(f => el[f] === undefined)).map(el => el.type).join(','));
  check('every element id is unique',
    new Set(document.elements.map(e => e.id)).size === document.elements.length);

  check('buildScene colours a box by its kind',
    rect.backgroundColor === KIND_STYLE.entry.background);
  check('buildScene weights a heavy arrow more', arrow.strokeWidth >= 3);

  const again = buildScene(repo, nodes, edges, {});
  check('buildScene is byte-deterministic',
    JSON.stringify(again.document) === JSON.stringify(document));

  const filtered = buildScene(repo, nodes, edges, { minWeight: 10 });
  check('minWeight hides a light edge', filtered.document.elements.filter(e => e.type === 'arrow').length === 0);

  const mermaid = toMermaid(repo, nodes, edges, {});
  check('toMermaid opens a flowchart', mermaid.startsWith('flowchart LR'));
  check('toMermaid names every box', mermaid.includes('"Src<br/>') && mermaid.includes('"Core<br/>'));
  check('toMermaid labels an edge with its weight', mermaid.includes('-->|7|'));
  check('toMermaid can run top-down', toMermaid(repo, nodes, edges, { direction: 'vertical' }).startsWith('flowchart TD'));

  const md = toMarkdown(repo, nodes, edges, {});
  check('toMarkdown titles the document', md.startsWith('# Architecture — demo'));
  check('toMarkdown embeds the mermaid diagram', md.includes('```mermaid'));
  check('toMarkdown lists the boxes', md.includes('| Src |'));
  check('toMarkdown reports the heaviest dependencies', md.includes('## Heaviest dependencies'));
  check('toMarkdown cites real numbers', md.includes('lines of code: 30'));
}

// ── The pipeline, against the real fixture on disk ────────────────────
if (!DatabaseSync) {
  console.log('\nSKIP stateful cases — node:sqlite unavailable on this Node build');
} else {
  // Walking the filesystem.
  {
    const walked = walkRepository(FIXTURE, {});
    const rels = walked.files.map(f => f.rel).sort();
    check('walkRepository finds the source files', rels.length === 7, rels.join(','));
    check('walkRepository skips node_modules', !rels.some(r => r.startsWith('node_modules/')));
    check('walkRepository skips dist', !rels.some(r => r.startsWith('dist/')));
    check('walkRepository skips a non-source file', !rels.includes('README.md') && !rels.includes('src/notes.txt'));
    check('walkRepository counts skipped entries', walked.skipped > 0);
    check('walkRepository reads the manifest', walked.manifest.name === 'fixture-repo');
    check('walkRepository reports the manifest entry', walked.manifest.entries.includes('src/main.mjs'));
    check('DEFAULT_SKIP_DIRS covers the usual suspects',
      DEFAULT_SKIP_DIRS.has('node_modules') && DEFAULT_SKIP_DIRS.has('.git'));
    check('walkRepository throws on a missing path', (() => {
      try { walkRepository(path.join(FIXTURE, 'nope'), {}); return false; } catch { return true; }
    })());
  }

  // Scan.
  await withState(async (state, opts) => {
    const scan = await scanRepository({ path: FIXTURE }, opts);
    check('scan_repository succeeds', scan.success === true, JSON.stringify(scan.output));
    check('scan_repository names the repo from the folder', scan.output.name === path.basename(FIXTURE));
    check('scan_repository found the source files', scan.output.files_scanned === 7, String(scan.output.files_scanned));
    check('scan_repository built the expected boxes', scan.output.node_count === 5,
      state.query('SELECT node_key FROM nodes').map(r => r.node_key).join(','));
    check('scan_repository built the expected edges', scan.output.edge_count === 3, String(scan.output.edge_count));
    check('scan_repository records the repo', state.query('SELECT COUNT(*) AS n FROM repos')[0].n === 1);
    check('scan_repository records languages',
      JSON.parse(state.query('SELECT languages FROM repos')[0].languages).javascript === 5);
    check('scan_repository marks the entry box',
      state.query('SELECT is_entry FROM nodes WHERE node_key = ?', ['src'])[0].is_entry === 1);
    check('scan_repository rolls up externals',
      JSON.parse(state.query('SELECT external_deps FROM nodes WHERE node_key = ?', ['src'])[0].external_deps)
        .some(d => d.name === 'express'));
    check('scan_repository stores a weight',
      state.query('SELECT weight FROM edges WHERE from_key = ? AND to_key = ?', ['src', 'src/core'])[0].weight === 1);
    check('scan_repository sets the board slice', state.get('board_state').nodes === 5);
    check('scan_repository logs the scan', state.list('board_log')[0].payload.event === 'scanned');
    check('scan_repository writes nothing beyond the graph tables',
      state.query('SELECT COUNT(*) AS n FROM exports')[0].n === 0);

    check('scan_repository rejects a missing path',
      (await scanRepository({ path: path.join(FIXTURE, 'nope') }, opts)).success === false);
    check('scan_repository requires a path', (await scanRepository({}, opts)).success === false);
    check('scan_repository rejects a file',
      (await scanRepository({ path: path.join(FIXTURE, 'package.json') }, opts)).success === false);

    // Rescan: a stale box from a deleted folder is worse than no box.
    const again = await scanRepository({ path: FIXTURE }, opts);
    check('a rescan replaces rather than appends',
      again.success && again.output.rescan === true && again.output.node_count === 5);
    check('a rescan does not duplicate repos', state.query('SELECT COUNT(*) AS n FROM repos')[0].n === 1);
    check('a rescan does not duplicate nodes', state.query('SELECT COUNT(*) AS n FROM nodes')[0].n === 5);
    check('a rescan does not duplicate edges', state.query('SELECT COUNT(*) AS n FROM edges')[0].n === 3);

    check('a coarser group_depth collapses boxes',
      (await scanRepository({ path: FIXTURE, group_depth: 1 }, opts)).output.node_count === 2);
    await scanRepository({ path: FIXTURE, group_depth: 2 }, opts);
  });

  // Annotate.
  await withState(async (state, opts) => {
    await scanRepository({ path: FIXTURE }, opts);

    const annotated = await annotateArchitecture({
      repo_id: 1,
      nodes: [
        { node_key: 'src', label: 'Entry', kind: 'entry', layer: 'Interface', detail: 'starts the app' },
        { node_key: 'src/core', label: 'Agent Runtime', kind: 'service', layer: 'Runtime' },
        { node_key: 'src/util', kind: 'util', layer: 'Runtime' },
      ],
    }, opts);
    check('annotate_architecture succeeds', annotated.success === true, JSON.stringify(annotated.output));
    check('annotate_architecture reports what changed', annotated.output.changed === 3);
    check('annotate_architecture writes the label',
      state.query('SELECT label FROM nodes WHERE node_key = ?', ['src/core'])[0].label === 'Agent Runtime');
    check('annotate_architecture writes the kind',
      state.query('SELECT kind FROM nodes WHERE node_key = ?', ['src/core'])[0].kind === 'service');
    check('annotate_architecture writes the layer',
      state.query('SELECT layer FROM nodes WHERE node_key = ?', ['src/core'])[0].layer === 'Runtime');
    check('annotate_architecture keeps labels distinct from kinds',
      state.query('SELECT label, kind FROM nodes WHERE node_key = ?', ['src'])[0].label === 'Entry');
    check('annotate_architecture records the detail',
      state.query('SELECT detail FROM nodes WHERE node_key = ?', ['src'])[0].detail === 'starts the app');
    check('annotate_architecture leaves untouched fields alone',
      state.query('SELECT detail FROM nodes WHERE node_key = ?', ['src/core'])[0].detail === null);
    check('annotate_architecture assigns one layer index per layer',
      state.query('SELECT layer_index FROM nodes WHERE node_key = ?', ['src/core'])[0].layer_index === 1);
    check('annotate_architecture counts what is left', annotated.output.unlabelled === 2);
    check('annotate_architecture logs the change', state.list('board_log')[0].payload.event === 'annotated');

    check('annotate_architecture rejects an unknown node',
      (await annotateArchitecture({ repo_id: 1, nodes: [{ node_key: 'nope', label: 'x' }] }, opts)).success === false);
    check('annotate_architecture rejects an unknown kind',
      (await annotateArchitecture({ repo_id: 1, nodes: [{ node_key: 'src', kind: 'wat' }] }, opts)).success === false);
    check('annotate_architecture rejects an empty change',
      (await annotateArchitecture({ repo_id: 1, nodes: [{ node_key: 'src' }] }, opts)).success === false);
    check('annotate_architecture rejects an unknown repo',
      (await annotateArchitecture({ repo_id: 99, nodes: [{ node_key: 'src', label: 'x' }] }, opts)).success === false);
    check('annotate_architecture rejects an empty node list',
      (await annotateArchitecture({ repo_id: 1, nodes: [] }, opts)).success === false);
    check('annotate_architecture applies nothing when it rejects',
      state.query('SELECT label FROM nodes WHERE node_key = ?', ['src'])[0].label === 'Entry');
    check('the allowed kinds include the documented set',
      KINDS.includes('entry') && KINDS.includes('store') && KINDS.includes('ui'));
  });

  // Arrange.
  await withState(async (state, opts) => {
    await scanRepository({ path: FIXTURE }, opts);
    await annotateArchitecture({ repo_id: 1, nodes: [{ node_key: 'src', layer: 'Interface' }] }, opts);

    const arranged = await arrangeDiagram({ repo_id: 1 }, opts);
    check('arrange_diagram succeeds', arranged.success === true, JSON.stringify(arranged.output));
    check('arrange_diagram defaults to layered', arranged.output.layout === 'layered');
    check('arrange_diagram reports the extent', arranged.output.extent.width > 0);
    check('arrange_diagram stores an order',
      state.query('SELECT COUNT(*) AS n FROM nodes WHERE sort_order >= 0')[0].n === 5);
    check('arrange_diagram keeps the dependency order',
      state.query('SELECT layer_index FROM nodes WHERE node_key = ?', ['src/core'])[0].layer_index === 1);
    check('arrange_diagram records the mode on the board', state.get('board_state').layout === 'layered');
    check('arrange_diagram logs the arrangement', state.list('board_log')[0].payload.event === 'arranged');

    const grid = await arrangeDiagram({ repo_id: 1, layout: 'grid' }, opts);
    check('arrange_diagram accepts a grid', grid.success && grid.output.layout === 'grid');
    check('arrange_diagram rejects an unknown layout',
      (await arrangeDiagram({ repo_id: 1, layout: 'spiral' }, opts)).success === false);
    check('arrange_diagram rejects an unknown direction',
      (await arrangeDiagram({ repo_id: 1, direction: 'sideways' }, opts)).success === false);
    check('arrange_diagram rejects an unknown repo',
      (await arrangeDiagram({ repo_id: 99 }, opts)).success === false);
  });

  // Export.
  await withState(async (state, opts) => {
    await scanRepository({ path: FIXTURE }, opts);
    await annotateArchitecture({
      repo_id: 1,
      nodes: [{ node_key: 'src', label: 'Entry', layer: 'Interface' }, { node_key: 'src/core', layer: 'Runtime' }],
    }, opts);
    await arrangeDiagram({ repo_id: 1 }, opts);

    const exc = await exportDiagram({ repo_id: 1, format: 'excalidraw' }, opts);
    check('export_diagram emits excalidraw by default', exc.success === true, JSON.stringify(exc.output));
    check('the excalidraw artifact parses', (() => {
      try { return JSON.parse(exc.output.artifact).type === 'excalidraw'; } catch { return false; }
    })());
    check('the excalidraw artifact is named', exc.output.filename.endsWith('.excalidraw'));
    check('the excalidraw artifact holds every element',
      JSON.parse(exc.output.artifact).elements.length === exc.output.element_count);
    check('the export records its size', exc.output.bytes > 1000);
    check('the export cites the box count', exc.output.node_count === 5);
    check('the export cites the edge count', exc.output.edge_count === 3);

    const excAgain = await exportDiagram({ repo_id: 1, format: 'excalidraw' }, opts);
    check('export_diagram is deterministic', excAgain.output.artifact === exc.output.artifact);

    const mermaid = await exportDiagram({ repo_id: 1, format: 'mermaid' }, opts);
    check('export_diagram emits mermaid', mermaid.output.artifact.startsWith('flowchart'));

    const md = await exportDiagram({ repo_id: 1, format: 'markdown' }, opts);
    check('export_diagram emits a spec document', md.output.artifact.startsWith('# Architecture'));
    check('the spec document uses the annotated labels', md.output.artifact.includes('| Entry |'));

    const json = await exportDiagram({ repo_id: 1, format: 'json' }, opts);
    const scene = JSON.parse(json.output.artifact);
    check('export_diagram emits a scene', Array.isArray(scene.nodes) && Array.isArray(scene.edges));
    check('the scene carries positions', scene.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));

    check('export_diagram honours min_weight',
      (await exportDiagram({ repo_id: 1, format: 'json', min_weight: 5 }, opts)).output.edge_count === 0);
    check('export_diagram rejects an unknown format',
      (await exportDiagram({ repo_id: 1, format: 'pdf' }, opts)).success === false);
    check('export_diagram rejects an unknown repo',
      (await exportDiagram({ repo_id: 99 }, opts)).success === false);
    check('the supported formats are the documented set',
      FORMATS.join(',') === 'excalidraw,mermaid,markdown,json');

    check('exports are recorded in the catalogue', state.query('SELECT COUNT(*) AS n FROM exports')[0].n === 6,
      String(state.query('SELECT COUNT(*) AS n FROM exports')[0].n));
    check('an export record keeps the format',
      state.query("SELECT COUNT(*) AS n FROM exports WHERE format = 'markdown'")[0].n === 1);
    check('an export record keeps the byte size',
      state.query('SELECT byte_size FROM exports ORDER BY id ASC LIMIT 1')[0].byte_size > 0);
    check('exporting increments the board counter', state.get('board_state').exported === 6);
  });

  // The summary.
  await withState(async (state, opts) => {
    await scanRepository({ path: FIXTURE }, opts);
    await annotateArchitecture({
      repo_id: 1,
      nodes: [
        { node_key: 'src', label: 'Entry', kind: 'entry', layer: 'Interface' },
        { node_key: 'src/core', label: 'Runtime', kind: 'service', layer: 'Runtime' },
        { node_key: 'src/util', kind: 'util', layer: 'Runtime' },
        { node_key: 'src/ui', kind: 'ui', layer: 'Interface' },
      ],
    }, opts);

    const arch = await getArchitecture({ repo_id: 1 }, opts);
    check('get_architecture succeeds', arch.success === true, JSON.stringify(arch.output.layers));
    check('get_architecture counts the boxes', arch.output.node_count === 5);
    check('get_architecture counts the edges', arch.output.edge_count === 3);
    check('get_architecture groups by layer', arch.output.layers.length === 3, JSON.stringify(arch.output.layers));
    check('get_architecture keeps unlabelled boxes in their own group',
      arch.output.layers.some(l => l.layer === '(unlabelled)' && l.nodes.includes('lib')));
    check('get_architecture finds the entry point',
      arch.output.entry_points.some(e => e.node_key === 'src'));
    check('get_architecture sums a layer',
      arch.output.layers.find(l => l.layer === 'Runtime').nodes.length === 2);
    check('get_architecture reports fan-in and fan-out',
      arch.output.boxes.find(b => b.node_key === 'src/core').fan_in === 2);
    check('get_architecture classifies a box by its fan-in and fan-out',
      arch.output.boxes.find(b => b.node_key === 'src/core').role === 'internal');
    check('get_architecture ranks the heaviest dependency',
      arch.output.heaviest_dependencies.length === 3 && arch.output.heaviest_dependencies[0].imports >= 1);
    check('get_architecture marks a cross-layer edge',
      arch.output.heaviest_dependencies.some(e => e.crosses_layer === true));
    check('get_architecture inventories externals',
      arch.output.external_dependencies.some(d => d.name === 'express'));
    check('get_architecture reports how many boxes are labelled', arch.output.labelled === 4);
    check('get_architecture rejects an unknown repo',
      (await getArchitecture({ repo_id: 99 }, opts)).success === false);
  });

  // Every handler must fail cleanly when the CLI injects no state handle.
  {
    const cases = [
      ['scan_repository', scanRepository, { path: FIXTURE }],
      ['annotate_architecture', annotateArchitecture, { repo_id: 1, nodes: [{ node_key: 'a' }] }],
      ['arrange_diagram', arrangeDiagram, { repo_id: 1 }],
      ['export_diagram', exportDiagram, { repo_id: 1 }],
      ['get_architecture', getArchitecture, { repo_id: 1 }],
    ];
    for (const [label, fn, args] of cases) {
      const result = await fn(args, {});
      check(`${label} reports a missing state handle`,
        result.success === false && typeof result.output === 'string');
    }
  }
}

fs.rmSync(FIXTURE, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL EXCALIDRAW-SPEC SELFTESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
