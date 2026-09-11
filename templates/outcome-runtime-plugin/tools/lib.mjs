export async function stateOf(options = {}) {
  if (!options.state) throw new Error('Plugin state is unavailable.');
  return await options.state;
}

export function nowIso() {
  return new Date().toISOString();
}

export function one(state, sql, params = []) {
  return (state.query(sql, params) || [])[0] || null;
}

export function run(state, sql, params = []) {
  return state.query(sql, params);
}

export function appendActivity(state, type, payload = {}) {
  if (typeof state.append === 'function') {
    state.append('activity', { type, ...payload });
  }
}
