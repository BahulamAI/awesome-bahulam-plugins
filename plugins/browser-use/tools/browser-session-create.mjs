import { nowIso, resolveState, sanitizeUrl } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const name = String(args.name || '').trim();
  const url = sanitizeUrl(args.url);
  const purpose = String(args.purpose || '').trim();
  const forceNew = args.force_new === true;
  if (!name) throw new Error('name is required');
  if (!purpose) throw new Error('purpose is required');

  if (!forceNew) {
    const runtime = state.get('browser_runtime_state', null);
    const activeSessionId = Number(runtime?.active_session_id);
    if (Number.isInteger(activeSessionId) && activeSessionId > 0 && runtime?.url === url) {
      const rows = state.query('SELECT * FROM browser_sessions WHERE id = ? LIMIT 1', [activeSessionId]);
      const active = rows[0];
      if (active && !['completed', 'cancelled', 'failed'].includes(String(active.status || '').toLowerCase())) {
        state.append('browser_activity', {
          type: 'session_reused',
          session_id: activeSessionId,
          name: active.name,
          url,
          purpose,
        });
        return {
          success: true,
          output: {
            session_id: activeSessionId,
            name: active.name,
            url,
            purpose: active.purpose,
            status: active.status,
            reused: true,
          },
        };
      }
    }

    const existing = state.query(
      `SELECT * FROM browser_sessions
       WHERE url = ? AND status IN ('planned', 'discovered', 'filled', 'blocked')
       ORDER BY id DESC LIMIT 1`,
      [url],
    )[0];
    if (existing) {
      state.set('browser_runtime_state', {
        active_session_id: Number(existing.id),
        url,
        status: existing.status,
        purpose: existing.purpose,
      });
      state.append('browser_activity', {
        type: 'session_reused',
        session_id: Number(existing.id),
        name: existing.name,
        url,
        purpose,
      });
      return {
        success: true,
        output: {
          session_id: Number(existing.id),
          name: existing.name,
          url,
          purpose: existing.purpose,
          status: existing.status,
          reused: true,
        },
      };
    }
  }

  const ts = nowIso();
  const result = state.query(
    `INSERT INTO browser_sessions (name, url, purpose, status, created_at, updated_at)
     VALUES (?, ?, ?, 'planned', ?, ?)`,
    [name, url, purpose, ts, ts],
  );
  const sessionId = Number(result.lastInsertRowid);
  state.set('browser_runtime_state', { active_session_id: sessionId, url, status: 'planned', purpose });
  state.append('browser_activity', { type: 'session_created', session_id: sessionId, name, url, purpose });

  return {
    success: true,
    output: { session_id: sessionId, name, url, purpose, status: 'planned' },
  };
}
