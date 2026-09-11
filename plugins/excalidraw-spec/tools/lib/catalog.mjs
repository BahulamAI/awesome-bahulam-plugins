/**
 * Catalog helpers — the thin layer between tool handlers and the declared
 * state tables.
 *
 * Kept separate so every handler reads and writes the graph the same way, and
 * so the selftest can exercise the real queries against a real SQLite file.
 * Every identifier here is a literal from plugin.yaml; no caller-supplied
 * string ever reaches SQL as a table or column name.
 */

export function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value === null || value === undefined ? fallback : value;
  } catch { return fallback; }
}

export function logEvent(state, payload) {
  return state.append('board_log', payload);
}

export function setBoard(state, payload) {
  return state.set('board_state', payload);
}

/**
 * Resolve a dataset-style reference to a repo row, or return a failure the
 * handler can pass straight back to the caller.
 */
export function requireRepo(state, repoId, toolName) {
  const id = Number(repoId);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, output: `${toolName}: \`repo_id\` must be a positive integer` };
  }
  const rows = state.query('SELECT * FROM repos WHERE id = ?', [id]);
  if (!rows.length) {
    return { ok: false, output: `${toolName}: no repository with id ${id}. Run scan_repository first.` };
  }
  return { ok: true, repo: rows[0] };
}

/** Nodes as the renderer wants them: parsed JSON columns, numbers coerced. */
export function readNodes(state, repoId) {
  return state.query(
    'SELECT * FROM nodes WHERE repo_id = ? ORDER BY layer_index ASC, sort_order ASC, node_key ASC',
    [Number(repoId)],
  ).map(row => ({
    node_key: row.node_key,
    label: row.label,
    detail: row.detail,
    kind: row.kind,
    layer: row.layer,
    layer_index: Number(row.layer_index || 0),
    source_path: row.source_path,
    file_count: Number(row.file_count || 0),
    loc: Number(row.loc || 0),
    languages: parseJson(row.languages, []),
    external_deps: parseJson(row.external_deps, []),
    is_entry: Number(row.is_entry || 0),
    is_external: Number(row.is_external || 0),
    sort_order: Number(row.sort_order || 0),
    // Position is filled in by the layout pass; zero here keeps the shape
    // stable so nothing downstream has to null-check.
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }));
}

export function readEdges(state, repoId) {
  return state.query(
    'SELECT * FROM edges WHERE repo_id = ? ORDER BY weight DESC, from_key ASC, to_key ASC',
    [Number(repoId)],
  ).map(row => ({
    from_key: row.from_key,
    to_key: row.to_key,
    kind: row.kind,
    label: row.label,
    weight: Number(row.weight || 0),
  }));
}

/**
 * Build the level map the layout uses, from the arrangement the tools stored.
 * This is what makes `arrange_diagram` the authority on layering rather than
 * a preview that the renderer then recomputes behind its back.
 */
export function storedLevels(nodes) {
  return new Map(nodes.map(n => [n.node_key, n.layer_index]));
}

export function recordExport(state, repoId, format, layoutMode, counts, byteSize) {
  const now = new Date().toISOString();
  state.query(
    'INSERT INTO exports(repo_id, format, layout, node_count, edge_count, element_count, byte_size, created_at) '
      + 'VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(repoId), format, layoutMode, counts.nodeCount, counts.edgeCount, counts.elementCount, byteSize, now],
  );
  return now;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'repo';
}
