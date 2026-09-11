/**
 * Scene emission — the graph rendered as an Excalidraw document.
 *
 * Excalidraw's file format is an open JSON document, so we EMIT it rather than
 * embedding the Excalidraw app. That is a deliberate choice with three
 * consequences worth stating:
 *
 *   1. No remote code. The repo's security policy forbids fetching scripts,
 *      so a CDN-hosted React app was never an option. We ship data, not code.
 *   2. The artifact is portable. A `.excalidraw` file opens in excalidraw.com,
 *      the VS Code extension, and Obsidian — the user can keep drawing on top
 *      of what we generated.
 *   3. It is diffable. Seeds are derived from stable strings, so re-exporting
 *      the same graph produces the same bytes and a git diff shows only real
 *      architectural change.
 *
 * Every element carries the full field set Excalidraw expects. A partial
 * element loads, but it loads as an invalid file, which is worse than not
 * loading at all.
 */

import { hash32 } from './scan.mjs';

/** Palette by kind, so the diagram is readable before it is explained. */
export const KIND_STYLE = {
  entry: { stroke: '#1971c2', background: '#a5d8ff' },
  service: { stroke: '#2f9e44', background: '#b2f2bb' },
  module: { stroke: '#495057', background: '#e9ecef' },
  store: { stroke: '#9c36b5', background: '#eebefa' },
  model: { stroke: '#e8590c', background: '#ffd8a8' },
  adapter: { stroke: '#0c8599', background: '#99e9f2' },
  ui: { stroke: '#c2255c', background: '#fcc2d7' },
  util: { stroke: '#868e96', background: '#f1f3f5' },
  external: { stroke: '#f08c00', background: '#ffec99' },
};

const DEFAULT_STYLE = { stroke: '#495057', background: '#e9ecef' };

/**
 * A fixed timestamp.
 *
 * Excalidraw stores `updated` on every element. Using the clock would make
 * every export differ, so determinism wins: the value records when this
 * generator was written, and the real provenance lives in the catalog.
 */
export const FIXED_UPDATED = 1735689600000; // 2025-01-01T00:00:00Z

function styleFor(kind) {
  return KIND_STYLE[kind] || DEFAULT_STYLE;
}

function elementId(prefix, key) {
  return `${prefix}_${hash32(key).toString(36)}`;
}

/** Excalidraw wants `points` relative to the element's own x/y. */
function arrowPoints(from, to) {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  const startsBeside = Math.abs(tx - fx) >= Math.abs(ty - fy);

  const sx = startsBeside ? (tx >= fx ? from.x + from.width : from.x) : fx;
  const sy = startsBeside ? fy : (ty >= fy ? from.y + from.height : from.y);
  const ex = startsBeside ? (tx >= fx ? to.x : to.x + to.width) : tx;
  const ey = startsBeside ? ty : (ty >= fy ? to.y : to.y + to.height);

  return {
    x: sx,
    y: sy,
    points: [[0, 0], [ex - sx, ey - sy]],
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
  };
}

function textLines(label, detail, maxChars = 26) {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) { current = word; continue; }
    if ((current + ' ' + word).length <= maxChars) current += ' ' + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [String(label || '')];
}

/**
 * Build the Excalidraw document for a laid-out graph.
 *
 * @returns {{document: object, elementCount: number}}
 */
export function buildScene(repo, nodes, edges, options = {}) {
  const minWeight = Math.max(1, Math.trunc(Number(options.minWeight) || 1));
  const byKey = new Map(nodes.map(n => [n.node_key, n]));
  const elements = [];

  const drawable = nodes.filter(n => !n.is_external);
  const drawableKeys = new Set(drawable.map(n => n.node_key));

  const visibleEdges = edges.filter(e => e.weight >= minWeight
    && drawableKeys.has(e.from_key) && drawableKeys.has(e.to_key));

  // Bindings must be declared on the shape, so index arrows by the boxes they
  // touch before emitting anything.
  const arrowsByNode = new Map(drawable.map(n => [n.node_key, []]));
  for (const edge of visibleEdges) {
    arrowsByNode.get(edge.from_key)?.push(edge);
    arrowsByNode.get(edge.to_key)?.push(edge);
  }

  const edgeId = edge => elementId('arrow', `${edge.from_key}->${edge.to_key}`);

  for (const node of drawable) {
    const style = styleFor(node.kind);
    const rectId = elementId('rect', node.node_key);
    const textId = elementId('text', node.node_key);
    const bound = arrowsByNode.get(node.node_key) || [];

    elements.push({
      id: rectId,
      type: 'rectangle',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      angle: 0,
      strokeColor: style.stroke,
      backgroundColor: style.background,
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: { type: 3 },
      seed: hash32(rectId),
      version: 1,
      versionNonce: hash32(`${rectId}:nonce`),
      isDeleted: false,
      updated: FIXED_UPDATED,
      link: null,
      locked: false,
      boundElements: [
        { type: 'text', id: textId },
        ...bound.map(e => ({ type: 'arrow', id: edgeId(e) })),
      ],
    });

    const label = textLines(node.label || node.node_key, null);
    const detail = node.detail ? String(node.detail) : null;
    const text = detail ? `${label.join('\n')}\n${detail}` : label.join('\n');
    const fontSize = label.join(' ').length > 22 ? 16 : 20;
    const lineCount = text.split('\n').length;
    const textHeight = Math.round(lineCount * fontSize * 1.25);

    elements.push({
      id: textId,
      type: 'text',
      x: node.x + 12,
      y: node.y + Math.max(8, (node.height - textHeight) / 2),
      width: node.width - 24,
      height: textHeight,
      angle: 0,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: hash32(textId),
      version: 1,
      versionNonce: hash32(`${textId}:nonce`),
      isDeleted: false,
      updated: FIXED_UPDATED,
      text,
      fontSize,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: rectId,
      originalText: text,
      lineHeight: 1.25,
      baseline: Math.round(fontSize * 0.9),
      link: null,
      locked: false,
    });
  }

  for (const edge of visibleEdges) {
    const from = byKey.get(edge.from_key);
    const to = byKey.get(edge.to_key);
    if (!from || !to) continue;
    const geometry = arrowPoints(from, to);
    const id = edgeId(edge);

    elements.push({
      id,
      type: 'arrow',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      angle: 0,
      strokeColor: '#495057',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      // Heavier arrows for heavier dependencies — the weight is the claim.
      strokeWidth: edge.weight >= 20 ? 4 : edge.weight >= 5 ? 3 : 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: { type: 2 },
      seed: hash32(id),
      version: 1,
      versionNonce: hash32(`${id}:nonce`),
      isDeleted: false,
      updated: FIXED_UPDATED,
      points: geometry.points,
      lastCommittedPoint: null,
      startBinding: { elementId: elementId('rect', edge.from_key), focus: 0, gap: 4 },
      endBinding: { elementId: elementId('rect', edge.to_key), focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: false,
      link: null,
      locked: false,
    });
  }

  // Excalidraw renders in array order; text must sit above its container.
  elements.sort((a, b) => {
    const rank = type => (type === 'rectangle' ? 0 : type === 'arrow' ? 1 : 2);
    return rank(a.type) - rank(b.type) || String(a.id).localeCompare(String(b.id));
  });

  const document = {
    type: 'excalidraw',
    version: 2,
    source: 'https://github.com/BahulamAI/awesome-bahulam-plugins (excalidraw-spec)',
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
      exportedWithDarkMode: false,
    },
    files: {},
  };

  return { document, elementCount: elements.length };
}

/** Mermaid needs identifier-safe node names, so the scene indexes them. */
export function toMermaid(repo, nodes, edges, options = {}) {
  const minWeight = Math.max(1, Math.trunc(Number(options.minWeight) || 1));
  const drawable = nodes.filter(n => !n.is_external);
  const ids = new Map(drawable.map((n, i) => [n.node_key, `n${i}`]));
  const direction = options.direction === 'vertical' ? 'TD' : 'LR';
  const out = [`flowchart ${direction}`];

  for (const node of drawable) {
    const title = String(node.label || node.node_key).replace(/"/g, '&quot;');
    const sub = node.detail
      ? `<br/><small>${String(node.detail).replace(/"/g, '&quot;')}</small>`
      : `<br/><small>${node.file_count} file${node.file_count === 1 ? '' : 's'} · ${node.loc} loc</small>`;
    out.push(`  ${ids.get(node.node_key)}["${title}${sub}"]`);
  }

  const classes = new Map();
  for (const node of drawable) {
    if (!classes.has(node.kind)) classes.set(node.kind, []);
    classes.get(node.kind).push(ids.get(node.node_key));
  }
  for (const [kind, members] of classes) out.push(`  class ${members.join(',')} ${kind};`);

  for (const edge of edges) {
    if (edge.weight < minWeight) continue;
    const a = ids.get(edge.from_key);
    const b = ids.get(edge.to_key);
    if (!a || !b) continue;
    out.push(`  ${a} -->|${edge.weight}| ${b}`);
  }

  return out.join('\n');
}

/**
 * The onboarding document: what this is, how to read it, and the evidence.
 */
export function toMarkdown(repo, nodes, edges, options = {}) {
  const minWeight = Math.max(1, Math.trunc(Number(options.minWeight) || 1));
  const out = [];
  const drawable = nodes.filter(n => !n.is_external);

  out.push(`# Architecture — ${repo.name}`);
  out.push('');
  out.push(`- scanned from: \`${repo.root_path}\``);
  out.push(`- files: ${repo.file_count} (${repo.source_file_count} source)`);
  out.push(`- lines of code: ${repo.total_loc}`);
  out.push(`- boxes: ${drawable.length} · dependencies: ${edges.length}`);
  out.push(`- scanned at: ${repo.scanned_at}`);
  out.push('');

  const entryPoints = drawable.filter(n => n.is_entry);
  if (entryPoints.length) {
    out.push('## Where it starts');
    out.push('');
    for (const node of entryPoints) {
      out.push(`- **${node.label}** — \`${node.source_path}\`${node.detail ? ` · ${node.detail}` : ''}`);
    }
    out.push('');
  }

  out.push('## How to read this');
  out.push('');
  out.push('Boxes are folders; arrows are imports parsed out of the source, so the');
  out.push('numbers are real. An arrow labelled `12` means twelve imports cross that');
  out.push('boundary. Thin arrows are usually incidental — raise `min_weight` to hide');
  out.push('them.');
  out.push('');
  out.push('```mermaid');
  out.push(toMermaid(repo, nodes, edges, { minWeight, direction: options.direction }));
  out.push('```');
  out.push('');

  out.push('## Boxes');
  out.push('');
  out.push('| box | path | kind | files | loc | languages |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const node of drawable) {
    const langs = (node.languages || []).map(l => l.name).join(', ');
    out.push(`| ${node.label} | \`${node.source_path}\` | ${node.kind} | ${node.file_count} | ${node.loc} | ${langs} |`);
  }
  out.push('');

  const heavy = edges.filter(e => e.weight >= minWeight).slice(0, 25);
  if (heavy.length) {
    out.push('## Heaviest dependencies');
    out.push('');
    out.push('| from | to | imports |');
    out.push('| --- | --- | --- |');
    for (const edge of heavy) out.push(`| ${edge.from_key} | ${edge.to_key} | ${edge.weight} |`);
    out.push('');
  }

  const externals = new Map();
  for (const node of drawable) {
    for (const dep of (node.external_deps || [])) {
      externals.set(dep.name, (externals.get(dep.name) || 0) + dep.count);
    }
  }
  if (externals.size) {
    out.push('## External dependencies');
    out.push('');
    const top = [...externals.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, 20);
    for (const [name, count] of top) out.push(`- \`${name}\` — ${count} import${count === 1 ? '' : 's'}`);
    out.push('');
  }

  return out.join('\n');
}
