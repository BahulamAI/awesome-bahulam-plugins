/**
 * Shared utility helpers for threejs-studio tools.
 */
export function nowIso() {
  return new Date().toISOString();
}

export function stateOf(options = {}) {
  return options.state || Promise.resolve(null);
}

export function hasSqlState(state) {
  return state && typeof state.query === 'function';
}

export function run(state, sql, params = []) {
  if (!hasSqlState(state)) return null;
  try { return state.query(sql, params); } catch { return null; }
}

export function rows(state, sql, params = []) {
  if (!hasSqlState(state)) return [];
  try { return state.query(sql, params) || []; } catch { return []; }
}

export function appendEvent(state, stream, payload) {
  if (!state || typeof state.append !== 'function') return false;
  try { state.append(stream, payload); return true; } catch { return false; }
}

export function appendStream(state, stream, ...entries) {
  if (!state || typeof state.append !== 'function') return false;
  for (const payload of entries) {
    try { state.append(stream, payload); } catch { /* skip */ }
  }
  return true;
}

export function intOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}