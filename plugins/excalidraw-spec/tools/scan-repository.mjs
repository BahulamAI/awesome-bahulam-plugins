/**
 * scan_repository — walk a repository and build its architecture graph.
 *
 * The evidence tool. It reads real files and parses real imports, so every
 * box and every arrow in the eventual diagram can be traced to something in
 * the source. Nothing here is guessed by a model, which is precisely why the
 * output is worth arguing with.
 *
 * The graph is rebuilt whole on each scan: a stale node from a deleted folder
 * is worse than no node, because the diagram would claim a component that no
 * longer exists.
 */

import fs from 'node:fs';
import path from 'node:path';

import { walkRepository } from './lib/scan.mjs';
import { buildEdges, buildNodes, computeLevels, externalsFor, languagesFor } from './lib/graph.mjs';
import { logEvent, readNodes, setBoard, slugify } from './lib/catalog.mjs';

export const name = 'scan_repository';
export const description = 'Walk a repository folder and build its architecture graph from real imports';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'scan_repository: plugin state unavailable' };

  const rootPath = String(args.path ?? '').trim();
  if (!rootPath) return { success: false, output: 'scan_repository: `path` is required' };

  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    return { success: false, output: `scan_repository: no such path: ${rootPath}` };
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return { success: false, output: `scan_repository: ${err.message}` };
  }
  if (!stat.isDirectory()) {
    return { success: false, output: `scan_repository: not a directory: ${rootPath}` };
  }

  const groupDepth = Number.isFinite(Number(args.group_depth)) && Number(args.group_depth) > 0
    ? Math.trunc(Number(args.group_depth))
    : 2;

  let walked;
  try {
    walked = walkRepository(resolved, {
      maxFiles: args.max_files,
      exclude: Array.isArray(args.exclude) ? args.exclude.map(String) : [],
    });
  } catch (err) {
    return { success: false, output: `scan_repository: ${err.message}` };
  }

  if (!walked.files.length) {
    return {
      success: false,
      output: `scan_repository: no source files found under ${rootPath}.`
        + ' Try a higher-level folder, or check that the language is one we read.',
    };
  }

  const repoName = String(args.name || path.basename(resolved) || 'repo').trim();
  const manifestEntries = walked.manifest.entries || [];

  const nodes = buildNodes(walked.files, { groupDepth, manifestEntries });
  const { edges, externalByKey } = buildEdges(walked.files, nodes, { groupDepth });
  const levels = computeLevels(nodes, edges);

  const now = new Date().toISOString();
  const existing = state.query('SELECT id, created_at FROM repos WHERE name = ?', [repoName]);
  let repoId;
  let replaced = false;

  const languageTotals = {};
  let totalLoc = 0;
  for (const file of walked.files) {
    languageTotals[file.language] = (languageTotals[file.language] || 0) + 1;
    totalLoc += file.loc;
  }
  const entryPoints = walked.files
    .filter(f => manifestEntries.includes(f.rel))
    .map(f => f.rel)
    .slice(0, 20);

  if (existing.length) {
    repoId = Number(existing[0].id);
    replaced = true;
    state.query(
      'UPDATE repos SET root_path = ?, root_label = ?, file_count = ?, source_file_count = ?, total_loc = ?, '
        + 'languages = ?, entry_points = ?, skipped_count = ?, scanned_at = ?, updated_at = ? WHERE id = ?',
      [resolved, path.basename(resolved), walked.files.length, walked.files.length, totalLoc,
        JSON.stringify(languageTotals), JSON.stringify(entryPoints), walked.skipped, now, now, repoId],
    );
    state.query('DELETE FROM nodes WHERE repo_id = ?', [repoId]);
    state.query('DELETE FROM edges WHERE repo_id = ?', [repoId]);
  } else {
    const info = state.query(
      'INSERT INTO repos(name, root_path, root_label, file_count, source_file_count, total_loc, languages, '
        + "entry_points, skipped_count, scanned_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [repoName, resolved, path.basename(resolved), walked.files.length, walked.files.length, totalLoc,
        JSON.stringify(languageTotals), JSON.stringify(entryPoints), walked.skipped, now, now, now],
    );
    repoId = Number(info.lastInsertRowid);
  }

  let sortOrder = 0;
  for (const node of nodes) {
    state.query(
      'INSERT INTO nodes(repo_id, node_key, label, detail, kind, layer, layer_index, source_path, file_count, '
        + 'loc, languages, external_deps, is_entry, is_external, sort_order, created_at, updated_at) '
        + 'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [repoId, node.node_key, node.label, node.detail, node.kind, node.layer,
        levels.get(node.node_key) || 0, node.source_path, node.file_count, node.loc,
        JSON.stringify(languagesFor(node)), JSON.stringify(externalsFor(node.node_key, externalByKey)),
        node.is_entry, node.is_external, sortOrder, now, now],
    );
    sortOrder += 1;
  }

  for (const edge of edges) {
    state.query(
      'INSERT INTO edges(repo_id, from_key, to_key, kind, label, weight, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
      [repoId, edge.from_key, edge.to_key, edge.kind, edge.label, edge.weight, now],
    );
  }

  const stored = readNodes(state, repoId);
  setBoard(state, {
    active_repo: repoName,
    repo_id: repoId,
    nodes: stored.length,
    edges: edges.length,
    exported: 0,
    updated_at: now,
  });
  logEvent(state, {
    event: replaced ? 'rescanned' : 'scanned',
    repo_id: repoId,
    repo: repoName,
    nodes: stored.length,
    edges: edges.length,
    at: now,
  });

  const byLanguage = Object.entries(languageTotals)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([language, files]) => ({ language, files }));

  return {
    success: true,
    output: {
      repo_id: repoId,
      name: repoName,
      root_path: resolved,
      rescan: replaced,
      group_depth: groupDepth,
      files_scanned: walked.files.length,
      files_skipped: walked.skipped,
      truncated: walked.truncated,
      total_loc: totalLoc,
      languages: byLanguage,
      node_count: stored.length,
      edge_count: edges.length,
      entry_points: stored.filter(n => n.is_entry).map(n => n.node_key),
      heaviest: edges.slice(0, 10).map(e => ({ from: e.from_key, to: e.to_key, imports: e.weight })),
      next_step: stored.length > 24
        ? 'the graph is large — consider a coarser group_depth, or annotate the boxes that matter before exporting'
        : 'call get_architecture to read the graph, then annotate_architecture to name the boxes',
    },
  };
}
