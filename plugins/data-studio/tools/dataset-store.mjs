/**
 * Shared in-memory dataset store.
 * All data-studio tools import this to read/write parsed datasets.
 * Datasets survive for the lifetime of the agent session.
 */

const _store = new Map();

export function get(name) {
  if (!_store.has(name)) throw new Error(`Dataset "${name}" not found. Load it first with load_dataset.`);
  return _store.get(name);
}

export function set(name, data, meta = {}) {
  _store.set(name, { data, meta });
}

export function list() {
  return Array.from(_store.entries()).map(([name, entry]) => ({
    name,
    rows: entry.data.length,
    cols: entry.meta.columns?.length ?? (entry.data[0] ? Object.keys(entry.data[0]).length : 0),
    columns: entry.meta.columns ?? [],
    ...entry.meta,
  }));
}

export function remove(name) {
  _store.delete(name);
}

export function clear() {
  _store.clear();
}