/**
 * export_diagram — render the architecture as a keepable artifact.
 *
 * Four formats, all generated from the same graph, all deterministic:
 *
 *   excalidraw  a real .excalidraw document — opens in excalidraw.com, the
 *               VS Code extension and Obsidian, and stays editable
 *   mermaid     text, so it lives in a README and renders on GitHub
 *   markdown    the onboarding spec: diagram, box inventory, heavy edges
 *   json        the raw scene, for a panel or another tool to consume
 *
 * Determinism is the point: two exports of an unchanged graph are byte-for-byte
 * identical, so a spec document can be committed and a diff then shows only
 * genuine architectural change.
 */

import {
  logEvent, readEdges, readNodes, recordExport, requireRepo, setBoard, storedLevels,
} from './lib/catalog.mjs';
import { layout } from './lib/graph.mjs';
import { buildScene, toMarkdown, toMermaid } from './lib/scene.mjs';

export const name = 'export_diagram';
export const description = 'Render the architecture as an Excalidraw board, Mermaid diagram or spec document';

export const FORMATS = ['excalidraw', 'mermaid', 'markdown', 'json'];

function buildPayload(format, repo, nodes, edges, ordered, options) {
  const drawable = ordered.filter(n => !n.is_external);
  const minWeight = Math.max(1, Math.trunc(Number(options.minWeight) || 1));
  const visibleEdges = edges.filter(e => e.weight >= minWeight);

  if (format === 'excalidraw') {
    const { document, elementCount } = buildScene(repo, ordered, edges, {
      minWeight, direction: options.direction,
    });
    return {
      artifact: JSON.stringify(document, null, 2),
      elementCount,
      counts: { nodeCount: drawable.length, edgeCount: visibleEdges.length },
      filename: `${repo.name}.excalidraw`,
      mediaType: 'application/json',
    };
  }

  if (format === 'mermaid') {
    const artifact = toMermaid(repo, ordered, edges, { minWeight, direction: options.direction });
    return {
      artifact,
      elementCount: drawable.length + visibleEdges.length,
      counts: { nodeCount: drawable.length, edgeCount: visibleEdges.length },
      filename: `${repo.name}-architecture.mmd`,
      mediaType: 'text/plain',
    };
  }

  if (format === 'markdown') {
    const artifact = toMarkdown(repo, ordered, edges, { minWeight, direction: options.direction });
    return {
      artifact,
      elementCount: drawable.length + visibleEdges.length,
      counts: { nodeCount: drawable.length, edgeCount: visibleEdges.length },
      filename: `${repo.name}-architecture.md`,
      mediaType: 'text/markdown',
    };
  }

  const artifact = JSON.stringify({
    repo: {
      id: Number(repo.id),
      name: repo.name,
      root_path: repo.root_path,
      file_count: Number(repo.file_count || 0),
      total_loc: Number(repo.total_loc || 0),
      scanned_at: repo.scanned_at,
    },
    layout: { mode: options.layout, direction: options.direction, min_weight: minWeight },
    nodes: ordered.map(n => ({
      node_key: n.node_key, label: n.label, detail: n.detail, kind: n.kind, layer: n.layer,
      layer_index: n.layer_index, source_path: n.source_path, file_count: n.file_count, loc: n.loc,
      languages: n.languages, external_deps: n.external_deps, is_entry: n.is_entry === 1,
      x: n.x, y: n.y, width: n.width, height: n.height,
    })),
    edges: visibleEdges,
  }, null, 2);

  return {
    artifact,
    elementCount: drawable.length + visibleEdges.length,
    counts: { nodeCount: drawable.length, edgeCount: visibleEdges.length },
    filename: `${repo.name}-architecture.json`,
    mediaType: 'application/json',
  };
}

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'export_diagram: plugin state unavailable' };

  const resolved = requireRepo(state, args.repo_id, 'export_diagram');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const repo = resolved.repo;
  const repoId = Number(repo.id);

  const format = String(args.format || 'excalidraw').toLowerCase();
  if (!FORMATS.includes(format)) {
    return { success: false, output: `export_diagram: \`format\` must be one of ${FORMATS.join(', ')}` };
  }

  const nodes = readNodes(state, repoId);
  if (!nodes.length) {
    return { success: false, output: `export_diagram: repository ${repoId} has no nodes. Run scan_repository first.` };
  }
  const edges = readEdges(state, repoId);

  const board = state.get('board_state', {}) || {};
  const layoutMode = args.layout ? String(args.layout).toLowerCase() : (board.layout || 'layered');
  if (layoutMode !== 'layered' && layoutMode !== 'grid') {
    return { success: false, output: 'export_diagram: `layout` must be "layered" or "grid"' };
  }
  const direction = args.direction ? String(args.direction).toLowerCase() : (board.direction || 'horizontal');

  const minWeight = Number.isFinite(Number(args.min_weight)) && Number(args.min_weight) > 0
    ? Math.trunc(Number(args.min_weight))
    : 1;

  // The arrangement stored by arrange_diagram is the authority, so the export
  // matches the board the user is looking at rather than re-deciding.
  const ordered = layout(nodes, edges, {
    layout: layoutMode, direction, levels: storedLevels(nodes),
  });

  let built;
  try {
    built = buildPayload(format, repo, nodes, edges, ordered, { layout: layoutMode, direction, minWeight });
  } catch (err) {
    return { success: false, output: `export_diagram: ${err.message}` };
  }

  const byteSize = Buffer.byteLength(built.artifact, 'utf8');
  const now = recordExport(state, repoId, format, layoutMode, {
    nodeCount: built.counts.nodeCount,
    edgeCount: built.counts.edgeCount,
    elementCount: built.elementCount,
  }, byteSize);

  setBoard(state, {
    ...board,
    active_repo: repo.name,
    repo_id: repoId,
    nodes: nodes.length,
    edges: edges.length,
    layout: layoutMode,
    direction,
    exported: Number(board.exported || 0) + 1,
    updated_at: now,
  });
  logEvent(state, {
    event: 'exported',
    repo_id: repoId,
    repo: repo.name,
    format,
    bytes: byteSize,
    at: now,
  });

  return {
    success: true,
    output: {
      repo_id: repoId,
      name: repo.name,
      format,
      layout: layoutMode,
      direction,
      min_weight: minWeight,
      filename: built.filename,
      media_type: built.mediaType,
      bytes: byteSize,
      node_count: built.counts.nodeCount,
      edge_count: built.counts.edgeCount,
      element_count: built.elementCount,
      exported_at: now,
      artifact: built.artifact,
    },
  };
}
