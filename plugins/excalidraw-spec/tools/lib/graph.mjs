/**
 * Graph building and layout.
 *
 * Turns a flat list of files into architectural boxes and the weighted edges
 * between them, then decides where each box sits. All pure functions — the
 * selftest exercises them without touching a filesystem or a database.
 *
 * The one idea worth stating: a diagram is a claim about what depends on
 * what. `weight` keeps that claim honest — an edge carrying 40 imports is a
 * boundary the system actually respects, and one carrying a single import is
 * usually noise.
 */

import { hash32, isBuiltinModule, languageOf, packageNameOf, resolveImport } from './scan.mjs';

/** Suffixes that usually mark the thing you run. */
const ENTRY_BASENAMES = new Set([
  'index', 'main', 'cli', 'app', 'server', 'start', 'run', 'bootstrap',
  '__main__', 'manage', 'wsgi', 'asgi', 'application',
]);

/** The root bucket, for files that sit at the top of the tree. */
export const ROOT_KEY = '.';

/**
 * Which box does a repo-relative file belong to?
 *
 * `group_depth` counts path SEGMENTS from the root, so depth 2 turns
 * `src/core/agent.mjs` into `src/core`. This is the dial that decides whether
 * the diagram explains the system or drowns in it.
 */
export function nodeKeyFor(relPath, groupDepth = 2) {
  const rel = String(relPath).replace(/\\/g, '/');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  if (!dir) return ROOT_KEY;
  const depth = Math.max(1, Math.trunc(Number(groupDepth) || 2));
  return dir.split('/').slice(0, depth).join('/');
}

/** `src/core` -> `Core`. Paths become titles; they are not titles. */
export function labelForKey(key) {
  if (key === ROOT_KEY) return '(root)';
  const last = key.split('/').filter(Boolean).pop() || key;
  return last
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => (word.length <= 3 && word === word.toLowerCase() ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function isEntryFile(rel, manifestEntries) {
  const base = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  if (ENTRY_BASENAMES.has(base.toLowerCase())) return true;
  return manifestEntries.includes(rel);
}

/**
 * Group walked files into architectural nodes.
 *
 * A node's `kind` starts as a blunt guess — `entry` if it holds a launch file,
 * otherwise `module`. The agent replaces it with something meaningful; keeping
 * the guess here means a scan alone still produces a legible diagram.
 */
export function buildNodes(files, options = {}) {
  const groupDepth = Math.max(1, Math.trunc(Number(options.groupDepth) || 2));
  const manifestEntries = options.manifestEntries || [];
  const byKey = new Map();

  for (const file of files) {
    const key = nodeKeyFor(file.rel, groupDepth);
    if (!byKey.has(key)) {
      byKey.set(key, {
        node_key: key,
        label: labelForKey(key),
        detail: null,
        kind: 'module',
        layer: null,
        layer_index: 0,
        source_path: key === ROOT_KEY ? '.' : key,
        file_count: 0,
        loc: 0,
        languages: new Map(),
        external: new Map(),
        is_entry: 0,
        is_external: 0,
      });
    }
    const node = byKey.get(key);
    node.file_count += 1;
    node.loc += file.loc;
    node.languages.set(file.language, (node.languages.get(file.language) || 0) + 1);
    if (isEntryFile(file.rel, manifestEntries)) node.is_entry = 1;
  }

  // Entry points dominate their box: a folder holding `cli.mjs` is where the
  // program starts, whatever else lives there.
  for (const node of byKey.values()) {
    if (node.is_entry) node.kind = 'entry';
  }

  return [...byKey.values()].sort((a, b) => a.node_key.localeCompare(b.node_key));
}

/**
 * Build weighted edges between nodes, and roll external packages up onto the
 * node that uses them.
 *
 * @returns {{edges: object[], externalByKey: Map<string, Map<string, number>>}}
 */
export function buildEdges(files, nodes, options = {}) {
  const groupDepth = Math.max(1, Math.trunc(Number(options.groupDepth) || 2));
  const knownFiles = new Set(files.map(f => f.rel));
  const nodeByKey = new Map(nodes.map(n => [n.node_key, n]));
  const weights = new Map();
  const externalByKey = new Map(nodes.map(n => [n.node_key, new Map()]));

  for (const file of files) {
    const fromKey = nodeKeyFor(file.rel, groupDepth);
    for (const spec of file.imports) {
      const target = resolveImport(spec, file.rel, knownFiles, file.language);
      if (target) {
        const toKey = nodeKeyFor(target, groupDepth);
        if (toKey === fromKey) continue; // internal detail, not architecture
        const id = `${fromKey}\u0000${toKey}`;
        weights.set(id, (weights.get(id) || 0) + 1);
        continue;
      }
      // A standard-library import is not a dependency anyone chose, so it
      // never becomes an edge or an inventory entry.
      if (isBuiltinModule(spec)) continue;
      const pkg = packageNameOf(spec, file.language);
      if (!pkg || pkg === '.' || pkg.startsWith('.')) continue;
      const bucket = externalByKey.get(fromKey);
      if (bucket) bucket.set(pkg, (bucket.get(pkg) || 0) + 1);
    }
  }

  const edges = [...weights.entries()]
    .map(([id, weight]) => {
      const [from_key, to_key] = id.split('\u0000');
      return { from_key, to_key, kind: 'import', label: null, weight };
    })
    .filter(edge => nodeByKey.has(edge.from_key) && nodeByKey.has(edge.to_key))
    .sort((a, b) => (b.weight - a.weight)
      || a.from_key.localeCompare(b.from_key)
      || a.to_key.localeCompare(b.to_key));

  return { edges, externalByKey };
}

/**
 * Longest-path depth over the dependency edges.
 *
 * Relaxation with a pass cap rather than a topological sort, because real
 * repositories contain import cycles and a sorter would simply throw. A cycle
 * carries no new information about layering, so bounding the passes is the
 * correct answer, not a compromise.
 */
export function computeLevels(nodes, edges) {
  const level = new Map(nodes.map(n => [n.node_key, 0]));
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from_key)) outgoing.set(edge.from_key, []);
    outgoing.get(edge.from_key).push(edge.to_key);
  }

  const maxPasses = Math.min(Math.max(nodes.length, 1), 64);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const [from, targets] of outgoing) {
      const base = level.get(from) || 0;
      for (const to of targets) {
        if ((level.get(to) || 0) < base + 1) {
          level.set(to, base + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return level;
}

/** Box geometry, derived from the label so text fits without measuring it. */
export function sizeFor(node) {
  const title = String(node.label || node.node_key);
  const widest = Math.max(title.length, node.detail ? Math.min(node.detail.length, 34) : 0);
  const width = Math.min(420, Math.max(180, Math.round(widest * 8.2) + 56));
  const height = node.detail ? 108 : 84;
  return { width, height };
}

/**
 * What role a box plays, from how much depends on it and how much it depends on.
 *
 * A box many things import and that imports little is a FOUNDATION — the thing
 * the system rests on. One that imports much and is imported by nobody is
 * TOP-LEVEL — a place work starts. Everything else is INTERNAL.
 *
 * Exported as a pure function so the thresholds can be tested directly: a
 * five-node fixture can never produce the fan-in this rule needs, and an
 * untestable threshold is how a rule quietly stops meaning anything.
 */
export function classifyRole(fanIn, fanOut) {
  const inbound = Number(fanIn) || 0;
  const outbound = Number(fanOut) || 0;
  if (inbound >= 3 && outbound <= 2) return 'foundation';
  if (outbound >= 3 && inbound === 0) return 'top-level';
  return 'internal';
}

/**
 * Place every node. Deterministic: same graph, same coordinates.
 *
 * `layered` follows the dependency levels computed above, so arrows run one
 * way and the reader can follow them. `grid` ignores the graph and packs by
 * name — useful when the graph is too dense for level order to mean anything.
 */
export function layout(nodes, edges, options = {}) {
  const mode = options.layout === 'grid' ? 'grid' : 'layered';
  const vertical = options.direction === 'vertical';
  const gapX = 90;
  const gapY = 46;
  // A stored arrangement wins over a recomputed one, so the renderer and the
  // exporter cannot drift from what `arrange_diagram` decided.
  const levels = options.levels instanceof Map ? options.levels : computeLevels(nodes, edges);

  const enriched = nodes.map(node => ({ node, size: sizeFor(node) }));

  let columns;
  if (mode === 'grid') {
    const perRow = Math.max(1, Math.ceil(Math.sqrt(enriched.length)));
    columns = Array.from({ length: perRow }, (_, i) => enriched.filter((_, idx) => idx % perRow === i));
  } else {
    const buckets = new Map();
    for (const item of enriched) {
      const level = levels.get(item.node.node_key) || 0;
      if (!buckets.has(level)) buckets.set(level, []);
      buckets.get(level).push(item);
    }
    columns = [...buckets.keys()].sort((a, b) => a - b).map(level => buckets.get(level)
      .sort((a, b) => a.node.node_key.localeCompare(b.node.node_key)));
  }

  const placed = [];
  let cursor = 0;
  for (const column of columns) {
    // Every box in a column is aligned on its leading edge, so the stack reads
    // as a stack rather than a ragged pile.
    let cross = 0;
    let extent = 0;
    for (const item of column) {
      const { width, height } = item.size;
      const along = cursor;
      const across = cross;
      placed.push({
        ...item.node,
        x: vertical ? across : along,
        y: vertical ? along : across,
        width,
        height,
        level: levels.get(item.node.node_key) || 0,
      });
      cross += (vertical ? width : height) + (vertical ? gapX : gapY);
      extent = Math.max(extent, vertical ? height : width);
    }
    cursor += extent + (vertical ? gapY : gapX);
  }

  // Normalise so the board starts at a fixed margin rather than at 0,0 — two
  // runs of the same graph must land on identical coordinates.
  const minX = Math.min(...placed.map(p => p.x), 0);
  const minY = Math.min(...placed.map(p => p.y), 0);
  for (const item of placed) {
    item.x = item.x - minX + 40;
    item.y = item.y - minY + 40;
  }
  return placed.sort((a, b) => a.node_key.localeCompare(b.node_key));
}

/** Roll the per-node external maps into the JSON column the schema stores. */
export function externalsFor(key, externalByKey, limit = 12) {
  const bucket = externalByKey.get(key);
  if (!bucket) return [];
  return [...bucket.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/** Languages for a node, as the JSON column the schema stores. */
export function languagesFor(node, limit = 4) {
  return [...node.languages.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export { hash32, languageOf };
