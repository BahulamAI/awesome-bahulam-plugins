/**
 * get_architecture — read the graph as a summary rather than as rows.
 *
 * `list_nodes` and `list_edges` answer "what is there"; this answers "what is
 * the shape of it". Layers with their weight, the handful of dependencies the
 * system actually rests on, where it starts, and what it leans on from
 * outside. That is what an agent needs before deciding how to describe it.
 *
 * Authored rather than generated because it aggregates across three tables.
 */

import { readEdges, readNodes, requireRepo } from './lib/catalog.mjs';
import { classifyRole } from './lib/graph.mjs';

export const name = 'get_architecture';
export const description = 'Summarise a repository architecture: layers, heaviest dependencies and entry points';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'get_architecture: plugin state unavailable' };

  const resolved = requireRepo(state, args.repo_id, 'get_architecture');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const repo = resolved.repo;
  const repoId = Number(repo.id);

  const topEdges = Number.isFinite(Number(args.top_edges)) && Number(args.top_edges) > 0
    ? Math.trunc(Number(args.top_edges)) : 25;
  const topExternals = Number.isFinite(Number(args.top_externals)) && Number(args.top_externals) > 0
    ? Math.trunc(Number(args.top_externals)) : 15;

  const nodes = readNodes(state, repoId);
  const edges = readEdges(state, repoId);
  if (!nodes.length) {
    return { success: false, output: `get_architecture: repository ${repoId} has no nodes. Run scan_repository first.` };
  }

  // Fan-in and fan-out are what tell an agent which boxes are load-bearing.
  const fanIn = new Map();
  const fanOut = new Map();
  for (const edge of edges) {
    fanIn.set(edge.to_key, (fanIn.get(edge.to_key) || 0) + edge.weight);
    fanOut.set(edge.from_key, (fanOut.get(edge.from_key) || 0) + edge.weight);
  }

  const boxes = nodes.map(node => ({
    node_key: node.node_key,
    label: node.label,
    detail: node.detail,
    kind: node.kind,
    layer: node.layer,
    is_entry: node.is_entry === 1,
    file_count: node.file_count,
    loc: node.loc,
    languages: node.languages.map(l => l.name),
    fan_in: fanIn.get(node.node_key) || 0,
    fan_out: fanOut.get(node.node_key) || 0,
    role: classifyRole(fanIn.get(node.node_key) || 0, fanOut.get(node.node_key) || 0),
  }));

  const layerMap = new Map();
  for (const box of boxes) {
    const layer = box.layer || '(unlabelled)';
    if (!layerMap.has(layer)) layerMap.set(layer, { layer, nodes: [], files: 0, loc: 0 });
    const bucket = layerMap.get(layer);
    bucket.nodes.push(box.node_key);
    bucket.files += box.file_count;
    bucket.loc += box.loc;
  }
  const layers = [...layerMap.values()].sort((a, b) => b.loc - a.loc);

  const externals = new Map();
  for (const node of nodes) {
    for (const dep of node.external_deps) {
      if (!externals.has(dep.name)) externals.set(dep.name, { name: dep.name, count: 0, used_by: [] });
      const bucket = externals.get(dep.name);
      bucket.count += dep.count;
      if (bucket.used_by.length < 5) bucket.used_by.push(node.node_key);
    }
  }
  const topPackages = [...externals.values()]
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
    .slice(0, topExternals);

  const heavyEdges = edges.slice(0, topEdges).map(e => ({
    from: e.from_key,
    to: e.to_key,
    imports: e.weight,
    crosses_layer: (nodes.find(n => n.node_key === e.from_key)?.layer || null)
      !== (nodes.find(n => n.node_key === e.to_key)?.layer || null),
  }));

  return {
    success: true,
    output: {
      repo_id: repoId,
      name: repo.name,
      root_path: repo.root_path,
      file_count: Number(repo.file_count || 0),
      total_loc: Number(repo.total_loc || 0),
      scanned_at: repo.scanned_at,
      node_count: boxes.length,
      edge_count: edges.length,
      labelled: boxes.filter(b => b.layer).length,
      layers: layers.map(l => ({
        layer: l.layer, nodes: l.nodes, files: l.files, loc: l.loc,
      })),
      entry_points: boxes.filter(b => b.is_entry).map(b => ({ node_key: b.node_key, label: b.label })),
      foundations: boxes.filter(b => b.role === 'foundation').map(b => b.node_key),
      heaviest_dependencies: heavyEdges,
      external_dependencies: topPackages,
      boxes,
    },
  };
}
