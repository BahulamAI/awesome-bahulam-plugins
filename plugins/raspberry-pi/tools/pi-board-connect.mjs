import { nowIso, resolveState } from './lib.mjs';

function targetFor(targetKind, { name, host, port, user }) {
  if (targetKind === 'ssh') return `${user}@${host}:${port}`;
  if (targetKind === 'virtual') return `virtual:${name}`;
  return 'local';
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const name = String(args.name || '').trim();
  const targetKind = ['ssh', 'virtual'].includes(args.target_kind) ? args.target_kind : 'local';
  const host = targetKind === 'ssh' ? String(args.host || '').trim() : '';
  const port = targetKind === 'ssh' ? Number(args.port || 22) : 0;
  const user = targetKind === 'ssh' ? String(args.user || '').trim() : '';
  const authEnv = targetKind === 'ssh' ? String(args.auth_env || '').trim() : '';
  const forceNew = args.force_new === true;

  if (!name) throw new Error('name is required');
  if (targetKind === 'ssh') {
    if (!host) throw new Error('host is required for target_kind=ssh');
    if (!user) throw new Error('user is required for target_kind=ssh');
    if (!authEnv) throw new Error('auth_env is required for target_kind=ssh (name of an env var holding a key path or password)');
  }

  const target = targetFor(targetKind, { name, host, port, user });

  if (!forceNew) {
    const runtime = state.get('pi_runtime_state', null);
    const activeBoardId = Number(runtime?.active_board_id);
    if (Number.isInteger(activeBoardId) && activeBoardId > 0 && runtime?.target === target) {
      const active = state.query('SELECT * FROM pi_boards WHERE id = ? LIMIT 1', [activeBoardId])[0];
      if (active && active.status !== 'failed') {
        state.append('pi_activity', { type: 'board_reused', board_id: activeBoardId, name: active.name, target });
        return {
          success: true,
          output: { board_id: activeBoardId, name: active.name, target_kind: targetKind, host, port, user, status: active.status, reused: true },
        };
      }
    }

    const existingQuery = targetKind === 'ssh'
      ? { sql: `SELECT * FROM pi_boards WHERE target_kind = 'ssh' AND host = ? AND port = ? AND user = ? AND status IN ('planned', 'connected') ORDER BY id DESC LIMIT 1`, params: [host, port, user] }
      : targetKind === 'virtual'
        ? { sql: `SELECT * FROM pi_boards WHERE target_kind = 'virtual' AND name = ? AND status IN ('planned', 'connected') ORDER BY id DESC LIMIT 1`, params: [name] }
        : { sql: `SELECT * FROM pi_boards WHERE target_kind = 'local' AND status IN ('planned', 'connected') ORDER BY id DESC LIMIT 1`, params: [] };
    const existing = state.query(existingQuery.sql, existingQuery.params)[0];
    if (existing) {
      state.set('pi_runtime_state', { active_board_id: Number(existing.id), target, status: existing.status });
      state.append('pi_activity', { type: 'board_reused', board_id: Number(existing.id), name: existing.name, target });
      return {
        success: true,
        output: { board_id: Number(existing.id), name: existing.name, target_kind: targetKind, host, port, user, status: existing.status, reused: true },
      };
    }
  }

  const ts = nowIso();
  const result = state.query(
    `INSERT INTO pi_boards (name, target_kind, host, port, user, auth_env, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
    [name, targetKind, host, port, user, authEnv, ts, ts],
  );
  const boardId = Number(result.lastInsertRowid);
  state.set('pi_runtime_state', { active_board_id: boardId, target, status: 'planned' });
  state.append('pi_activity', { type: 'board_created', board_id: boardId, name, target });

  return { success: true, output: { board_id: boardId, name, target_kind: targetKind, host, port, user, status: 'planned' } };
}
