import { execFile } from 'node:child_process';
import fs from 'node:fs';

export function nowIso() {
  return new Date().toISOString();
}

export async function resolveState(options = {}) {
  const state = await options.state;
  if (!state) throw new Error('raspberry-pi tools require plugin state');
  return state;
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function sanitizePin(pin) {
  const n = Number(pin);
  if (!Number.isInteger(n) || n < 0 || n > 27) throw new Error('pin must be a BCM GPIO number between 0 and 27');
  return n;
}

export function resolveEnvSecret(name) {
  const key = String(name || '').trim();
  if (!key) throw new Error('auth_env is required for ssh boards');
  const value = process.env[key];
  if (!value) throw new Error(`Environment variable ${key} is not set. Point it at an SSH private key path or a password before connecting.`);
  return value;
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// --- local execution ---------------------------------------------------

export function execLocal(cmd, args = [], options = {}) {
  if (typeof options.exec === 'function') return options.exec(cmd, args);
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return reject(err);
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: err ? Number(err.code ?? 1) : 0 });
    });
  });
}

// --- ssh execution -------------------------------------------------------

async function resolveSshClient(options = {}) {
  if (options.ssh) return typeof options.ssh === 'function' ? options.ssh() : options.ssh;
  try {
    const mod = await import('ssh2');
    return new mod.Client();
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`ssh2 is required for target_kind=ssh. Install it with: npm install ssh2. ${msg}`);
  }
}

export function execSsh(client, board, cmd, args = []) {
  const secret = resolveEnvSecret(board.auth_env);
  const isKeyPath = fs.existsSync(secret);
  const auth = isKeyPath ? { privateKey: fs.readFileSync(secret) } : { password: secret };
  const commandLine = [cmd, ...args.map(quoteShellArg)].join(' ');

  return new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        client.exec(commandLine, (err, stream) => {
          if (err) { client.end(); return reject(err); }
          let stdout = '';
          let stderr = '';
          stream.on('close', code => {
            client.end();
            resolve({ stdout, stderr, code: Number(code || 0) });
          }).on('data', chunk => { stdout += chunk.toString(); });
          stream.stderr.on('data', chunk => { stderr += chunk.toString(); });
        });
      })
      .on('error', reject)
      .connect({ host: board.host, port: Number(board.port || 22), username: board.user, ...auth });
  });
}

/**
 * Dispatches a command to a board's real (local or ssh) target. Never call
 * this for target_kind='virtual' boards — those are simulated entirely from
 * plugin state, with no process or network execution at all.
 */
export async function runOnBoard(board, cmd, args = [], options = {}) {
  if (board.target_kind === 'local') return execLocal(cmd, args, options);
  const client = await resolveSshClient(options);
  return execSsh(client, board, cmd, args);
}

// --- output parsers -------------------------------------------------------

export function parsePinctrlOutput(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(\d+):\s+(\S+)\s+(\S+)\s*\|\s*(\S+)\s*(?:\/\/\s*(.*))?$/);
      if (!m) return null;
      return { pin: Number(m[1]), func: m[2], pull: m[3], level: m[4], label: (m[5] || '').trim() };
    })
    .filter(Boolean);
}

export function parseI2cDetectOutput(text) {
  const addresses = [];
  const lines = String(text || '').split('\n').slice(1); // skip the column-header row
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (!parts.length) continue;
    const rowBase = parseInt(String(parts[0]).replace(':', ''), 16);
    if (Number.isNaN(rowBase)) continue;
    parts.slice(1).forEach((cell, i) => {
      if (cell && cell !== '--' && /^[0-9a-f]{2}$/i.test(cell)) {
        addresses.push(`0x${(rowBase + i).toString(16)}`);
      }
    });
  }
  return addresses;
}

// --- virtual board simulation state ---------------------------------------

export function getSimPin(state, boardId, pin) {
  return state.query('SELECT * FROM pi_sim_pins WHERE board_id = ? AND pin = ? LIMIT 1', [boardId, pin])[0] || null;
}

export function upsertSimPin(state, boardId, pin, fields = {}) {
  const existing = getSimPin(state, boardId, pin);
  const level = fields.level !== undefined ? Number(fields.level) : (existing ? existing.level : 0);
  const dutyCycle = fields.duty_cycle !== undefined ? Number(fields.duty_cycle) : (existing ? existing.duty_cycle : null);
  const fault = fields.fault !== undefined ? String(fields.fault) : (existing ? existing.fault : '');
  const ts = nowIso();
  if (existing) {
    state.query(
      'UPDATE pi_sim_pins SET level = ?, duty_cycle = ?, fault = ?, updated_at = ? WHERE id = ?',
      [level, dutyCycle, fault, ts, existing.id],
    );
  } else {
    state.query(
      'INSERT INTO pi_sim_pins (board_id, pin, level, duty_cycle, fault, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [boardId, pin, level, dutyCycle, fault, ts],
    );
  }
  return getSimPin(state, boardId, pin);
}

export function getSimRegister(state, boardId, address, register) {
  return state.query(
    'SELECT * FROM pi_sim_registers WHERE board_id = ? AND address = ? AND register = ? LIMIT 1',
    [boardId, address, register],
  )[0] || null;
}

export function upsertSimRegister(state, boardId, address, register, fields = {}) {
  const existing = getSimRegister(state, boardId, address, register);
  const value = fields.value !== undefined ? String(fields.value) : (existing ? existing.value : '00');
  const fault = fields.fault !== undefined ? String(fields.fault) : (existing ? existing.fault : '');
  const ts = nowIso();
  if (existing) {
    state.query(
      'UPDATE pi_sim_registers SET value = ?, fault = ?, updated_at = ? WHERE id = ?',
      [value, fault, ts, existing.id],
    );
  } else {
    state.query(
      'INSERT INTO pi_sim_registers (board_id, address, register, value, fault, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [boardId, address, register, value, fault, ts],
    );
  }
  return getSimRegister(state, boardId, address, register);
}
