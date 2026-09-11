/**
 * arrange_diagram — decide and store where the boxes sit.
 *
 * Renaming a box changes its width, and a layer assignment changes its column,
 * so the arrangement is not a cosmetic afterthought: it is the step that turns
 * a graph into something a person can read.
 *
 * The stored `layer_index` is what the renderer and the exporter both obey, so
 * the board on screen and the exported document cannot disagree about order.
 */

import { logEvent, readEdges, readNodes, requireRepo, setBoard } from './lib/catalog.mjs';
import { computeLevels, layout } from './lib/graph.mjs';

export const name = 'arrange_diagram';
export const description = 'Compute and store the layout of a repository diagram so boxes read in dependency order';

export const LAYOUTS = ['layered', 'grid'];
export const DIRECTIONS = ['horizontal', 'vertical'];

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'arrange_diagram: plugin state unavailable' };

  const resolved = requireRepo(state, args.repo_id, 'arrange_diagram');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const repoId = Number(resolved.repo.id);

  const mode = args.layout === undefined || args.layout === null || args.layout === ''
    ? 'layered'
    : String(args.layout).toLowerCase();
  if (!LAYOUTS.includes(mode)) {
    return { success: false, output: `arrange_diagram: \`layout\` must be one of ${LAYOUTS.join(', ')}` };
  }

  const direction = args.direction === undefined || args.direction === null || args.direction === ''
    ? 'horizontal'
    : String(args.direction).toLowerCase();
  if (!DIRECTIONS.includes(direction)) {
    return { success: false, output: `arrange_diagram: \`direction\` must be one of ${DIRECTIONS.join(', ')}` };
  }

  const nodes = readNodes(state, repoId);
  if (!nodes.length) {
    return { success: false, output: `arrange_diagram: repository ${repoId} has no nodes. Run scan_repository first.` };
  }
  const edges = readEdges(state, repoId);

  // Layered order comes from the graph; grid order is just name order. Either
  // way the result is written back so every consumer agrees.
  const levels = mode === 'grid'
    ? new Map(nodes.map((n, i) => [n.node_key, Math.floor(i / Math.max(1, Math.ceil(Math.sqrt(nodes.length))))]))
    : computeLevels(nodes, edges);

  const ordered = layout(nodes, edges, { layout: mode, direction, levels });
  const now = new Date().toISOString();

  let sortOrder = 0;
  for (const placed of ordered) {
    const level = levels.get(placed.node_key) || 0;
    state.query(
      'UPDATE nodes SET layer_index = ?, sort_order = ?, updated_at = ? WHERE repo_id = ? AND node_key = ?',
      [level, sortOrder, now, repoId, placed.node_key],
    );
    sortOrder += 1;
  }

  // Persist the mode on the board so the panel renders the same thing the
  // agent just arranged rather than guessing its own default.
  const board = state.get('board_state', {}) || {};
  setBoard(state, {
    ...board,
    active_repo: resolved.repo.name,
    repo_id: repoId,
    nodes: nodes.length,
    edges: edges.length,
    layout: mode,
    direction,
    updated_at: now,
  });
  logEvent(state, {
    event: 'arranged',
    repo_id: repoId,
    repo: resolved.repo.name,
    layout: mode,
    at: now,
  });

  const unlayered = ordered.filter(n => !n.layer).length;
  return {
    success: true,
    output: {
      repo_id: repoId,
      layout: mode,
      direction,
      node_count: ordered.length,
      columns: new Set(ordered.map(n => n.level)).size,
      extent: {
        width: Math.max(...ordered.map(n => n.x + n.width), 0),
        height: Math.max(...ordered.map(n => n.y + n.height), 0),
      },
      nodes: ordered.map(n => ({ node_key: n.node_key, level: n.level, x: n.x, y: n.y })),
      unlayered,
      next_step: unlayered > 0
        ? 'some boxes have no layer yet — call annotate_architecture to name the layers, then export'
        : 'call export_diagram to produce the deliverable',
    },
  };
}
