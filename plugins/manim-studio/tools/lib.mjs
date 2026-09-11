export function nowIso() {
  return new Date().toISOString();
}

export async function stateOf(options = {}) {
  return options.state ? await options.state : null;
}

export function hasSqlState(state) {
  return state && typeof state.query === 'function';
}

export function run(state, sql, params = []) {
  if (!hasSqlState(state)) return null;
  return state.query(sql, params);
}

export function rows(state, sql, params = []) {
  if (!hasSqlState(state)) return [];
  return state.query(sql, params) || [];
}

export function appendEvent(state, type, payload = {}) {
  if (state && typeof state.append === 'function') {
    state.append('render_activity', { type, ...payload, recorded_at: nowIso() });
  }
}

export function appendStream(state, stream, payload = {}) {
  if (state && typeof state.append === 'function') {
    state.append(stream, payload);
  }
}

export function intOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
