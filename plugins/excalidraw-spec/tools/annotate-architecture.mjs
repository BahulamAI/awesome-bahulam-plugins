/**
 * annotate_architecture — put human meaning on the scanned boxes.
 *
 * The scanner knows `src/core` holds 14 files and 9,000 lines. It cannot know
 * that means "Agent Runtime". This tool is where that judgement is recorded,
 * and it is deliberately the only writer of `label`, `detail`, `kind` and
 * `layer` — one writer means the board never flickers between two opinions.
 *
 * Partial by design: only the fields present in a given entry are touched, so
 * an agent can name a box now and decide its layer later.
 */

import { logEvent, readNodes, requireRepo } from './lib/catalog.mjs';

export const name = 'annotate_architecture';
export const description = 'Set labels, kinds and layers on scanned nodes so the diagram explains the system';

/** The kinds the palette knows how to colour. */
export const KINDS = ['entry', 'service', 'module', 'store', 'model', 'adapter', 'ui', 'util', 'external'];

/**
 * Layer order is the reading order of the diagram, so the agent's first layer
 * ends up on the left. Indices are assigned by first appearance, and the map
 * is carried THROUGH the loop rather than rebuilt from the pre-update rows —
 * otherwise two brand-new layers in one call both land on index 0 and the
 * columns collapse into each other.
 */
function layerIndexesFrom(nodes) {
  const known = new Map();
  for (const node of nodes) {
    if (node.layer && !known.has(node.layer)) known.set(node.layer, known.size);
  }
  return known;
}

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'annotate_architecture: plugin state unavailable' };

  const resolved = requireRepo(state, args.repo_id, 'annotate_architecture');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const repoId = Number(resolved.repo.id);

  const incoming = Array.isArray(args.nodes) ? args.nodes : [];
  if (!incoming.length) {
    return { success: false, output: 'annotate_architecture: `nodes` must be a non-empty array' };
  }

  const existing = readNodes(state, repoId);
  const byKey = new Map(existing.map(n => [n.node_key, n]));
  const layerIndexes = layerIndexesFrom(existing);
  const now = new Date().toISOString();

  // Validate everything before writing anything: a half-applied annotation is
  // worse than a rejected one, because the board silently tells half a story.
  const planned = [];
  const unknown = [];
  const invalid = [];

  for (const entry of incoming) {
    if (!entry || typeof entry !== 'object') { invalid.push('an entry was not an object'); continue; }
    const key = String(entry.node_key ?? '').trim();
    if (!key) { invalid.push('an entry was missing `node_key`'); continue; }
    if (!byKey.has(key)) { unknown.push(key); continue; }

    const sets = [];
    const values = [];

    if (entry.label !== undefined && String(entry.label).trim()) {
      sets.push('label = ?');
      values.push(String(entry.label).trim().slice(0, 120));
    }
    if (entry.detail !== undefined) {
      const detail = String(entry.detail).trim();
      sets.push('detail = ?');
      values.push(detail ? detail.slice(0, 400) : null);
    }
    if (entry.kind !== undefined && String(entry.kind).trim()) {
      const kind = String(entry.kind).trim().toLowerCase();
      if (!KINDS.includes(kind)) { invalid.push(`kind "${kind}" for ${key} is not one of ${KINDS.join(', ')}`); continue; }
      sets.push('kind = ?');
      values.push(kind);
    }
    if (entry.layer !== undefined) {
      const layer = String(entry.layer).trim();
      let index = 0;
      if (layer) {
        if (!layerIndexes.has(layer)) layerIndexes.set(layer, layerIndexes.size);
        index = layerIndexes.get(layer);
      }
      sets.push('layer = ?', 'layer_index = ?');
      values.push(layer || null, index);
    }

    if (!sets.length) { invalid.push(`${key} had no changed fields`); continue; }
    planned.push({ key, sets, values });
  }

  if (unknown.length) {
    const sample = existing.slice(0, 8).map(n => n.node_key).join(', ');
    return {
      success: false,
      output: `annotate_architecture: unknown node(s): ${unknown.join(', ')}.`
        + ` Use list_nodes for the real keys — for example: ${sample}`,
    };
  }
  if (invalid.length) {
    return { success: false, output: `annotate_architecture: ${invalid.join('; ')}` };
  }

  for (const item of planned) {
    state.query(
      `UPDATE nodes SET ${item.sets.join(', ')}, updated_at = ? WHERE repo_id = ? AND node_key = ?`,
      [...item.values, now, repoId, item.key],
    );
  }

  const after = readNodes(state, repoId);
  const layers = [...new Set(after.map(n => n.layer).filter(Boolean))];

  logEvent(state, {
    event: 'annotated',
    repo_id: repoId,
    repo: resolved.repo.name,
    changed: planned.length,
    layers: layers.length,
    at: now,
  });

  return {
    success: true,
    output: {
      repo_id: repoId,
      changed: planned.length,
      nodes: after.map(n => ({
        node_key: n.node_key,
        label: n.label,
        kind: n.kind,
        layer: n.layer,
        has_detail: Boolean(n.detail),
      })),
      layers,
      unlabelled: after.filter(n => !n.layer).length,
      next_step: 'call arrange_diagram to re-lay-out against the new labels',
    },
  };
}
