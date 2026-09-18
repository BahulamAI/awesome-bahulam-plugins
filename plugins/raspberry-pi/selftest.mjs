import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { call as connectBoard } from './tools/pi-board-connect.mjs';
import { call as discoverBoard } from './tools/pi-board-discover.mjs';
import { call as configurePin } from './tools/pi-pin-configure.mjs';
import { call as writeGpio } from './tools/pi-gpio-write.mjs';
import { call as readGpio } from './tools/pi-gpio-read.mjs';
import { call as readSensor } from './tools/pi-sensor-read.mjs';
import { call as seedSim } from './tools/pi-sim-seed.mjs';
import { call as recordAction } from './tools/pi-action-record.mjs';
import { call as reportBoard } from './tools/pi-board-report.mjs';
import { call as diagramBoard } from './tools/pi-board-diagram.mjs';
import { call as advisorLlm } from './tools/pi-llm-advisor.mjs';
import { call as advisorOs } from './tools/pi-os-advisor.mjs';

let failures = 0;
function ok(label, cond) {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
}

const DDL = `
CREATE TABLE pi_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'local',
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 0,
  user TEXT NOT NULL DEFAULT '',
  auth_env TEXT NOT NULL DEFAULT '',
  ram_gb INTEGER,
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE pi_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  mode TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  is_actuator INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE pi_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  pin INTEGER,
  value_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE pi_sim_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  duty_cycle REAL,
  fault TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(board_id, pin)
);
CREATE TABLE pi_sim_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  register TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '00',
  fault TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(board_id, address, register)
);
CREATE TABLE pi_advisories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER,
  advisor TEXT NOT NULL,
  workload TEXT NOT NULL DEFAULT '',
  ram_gb INTEGER NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '{}',
  recommendation_json TEXT NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

function makeState() {
  const db = new DatabaseSync(':memory:');
  db.exec(DDL);
  const kv = new Map();
  const records = [];
  return {
    get(key, fallback = null) {
      return kv.has(key) ? JSON.parse(kv.get(key)) : fallback;
    },
    set(key, value) {
      kv.set(key, JSON.stringify(value));
      return value;
    },
    append(stream, payload) {
      records.push({ id: records.length + 1, stream, payload, created_at: new Date(0).toISOString() });
      return records.length;
    },
    list(stream) {
      return records.filter(row => row.stream === stream);
    },
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (String(sql).trim().slice(0, 6).toUpperCase() === 'SELECT') return stmt.all(...params);
      const info = stmt.run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    close() {
      db.close();
    },
  };
}

// --- fake local executor (target_kind=local) --------------------------
function mockExec(responses) {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    for (const [pattern, out] of responses) {
      if (key.includes(pattern)) return out;
    }
    return { stdout: '', stderr: '', code: 0 };
  };
}

// --- fake ssh2 client (target_kind=ssh) --------------------------------
function mockSshFactory(responses) {
  return () => {
    const client = new EventEmitter();
    client.connect = () => { queueMicrotask(() => client.emit('ready')); return client; };
    client.exec = (commandLine, cb) => {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      cb(null, stream);
      queueMicrotask(() => {
        let out = { stdout: '', code: 0 };
        for (const [pattern, res] of responses) {
          if (commandLine.includes(pattern)) { out = res; break; }
        }
        if (out.stdout) stream.emit('data', Buffer.from(out.stdout));
        stream.emit('close', out.code ?? 0);
      });
    };
    client.end = () => {};
    return client;
  };
}

const state = makeState();

try {
  // ===================== LOCAL BOARD =====================
  const localExec = mockExec([
    ['device-tree/model', { stdout: 'Raspberry Pi 4 Model B\u0000' }],
    ['pinctrl get 17', { stdout: '17: op    dh | hi // GPIO17 = output' }],
    ['pinctrl', { stdout: '17: ip    pd | lo // GPIO17 = input\n27: ip    pd | lo // GPIO27 = input' }],
    ['i2cdetect', { stdout: '     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f\n00:                         -- -- -- -- -- -- -- --\n40: -- -- -- -- -- -- -- -- 48 -- -- -- -- -- -- --\n' }],
  ]);
  const localOptions = { state: Promise.resolve(state), exec: localExec, workspaceRoot: process.cwd() };

  const localBoard = await connectBoard({ name: 'bench-pi', target_kind: 'local' }, localOptions);
  ok('pi_board_connect creates a local board', localBoard.success && localBoard.output.board_id === 1);
  const localReused = await connectBoard({ name: 'bench-pi again' }, localOptions);
  ok('pi_board_connect reuses the local board', localReused.output.board_id === 1 && localReused.output.reused === true);

  const localDiscover = await discoverBoard({ board_id: 1 }, localOptions);
  ok('pi_board_discover (local) finds pins and i2c devices', localDiscover.success && localDiscover.output.pin_count === 2 && localDiscover.output.i2c_addresses.includes('0x48'));

  await configurePin({ board_id: 1, pin: 17, mode: 'out', role: 'status LED' }, localOptions);
  const localBlocked = await writeGpio({ board_id: 1, pin: 17, level: true }, localOptions);
  ok('pi_gpio_write (local) blocks without approval', localBlocked.output.blocked === true);
  const localWritten = await writeGpio({ board_id: 1, pin: 17, level: true, approved: true }, localOptions);
  ok('pi_gpio_write (local) executes with approval', localWritten.output.blocked === false);
  const localRead = await readGpio({ board_id: 1, pin: 17 }, localOptions);
  ok('pi_gpio_read (local) reads a level', localRead.output.level === 1);

  // ===================== SSH BOARD =====================
  process.env.TEST_PI_SSH_KEY = 'super-secret-password';
  const sshFactory = mockSshFactory([
    ['device-tree/model', { stdout: 'Raspberry Pi 3 Model B+\u0000' }],
    ['pinctrl', { stdout: '4: ip    pu | hi // GPIO4 = input' }],
    ['i2cdetect', { stdout: '     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f\n70: -- -- -- -- -- -- 76 --\n' }],
    ['i2cget', { stdout: '0x17\n' }],
  ]);
  const sshOptions = { state: Promise.resolve(state), ssh: sshFactory, workspaceRoot: process.cwd() };

  const sshBoard = await connectBoard({ name: 'shed-pi', target_kind: 'ssh', host: '192.168.1.42', user: 'pi', auth_env: 'TEST_PI_SSH_KEY' }, sshOptions);
  ok('pi_board_connect creates an ssh board', sshBoard.success && sshBoard.output.board_id === 2);

  const sshDiscover = await discoverBoard({ board_id: 2 }, sshOptions);
  ok('pi_board_discover (ssh) finds pins and i2c devices', sshDiscover.output.pin_count === 1 && sshDiscover.output.i2c_addresses.includes('0x76'));

  const sshSensor = await readSensor({ board_id: 2, address: '0x76', register: '0x00' }, sshOptions);
  ok('pi_sensor_read (ssh) returns the register value', sshSensor.output.raw === '0x17');

  // ===================== VIRTUAL BOARD =====================
  const virtualOptions = { state: Promise.resolve(state), workspaceRoot: process.cwd() };
  const virtualBoard = await connectBoard({ name: 'ci-bench', target_kind: 'virtual' }, virtualOptions);
  ok('pi_board_connect creates a virtual board', virtualBoard.success && virtualBoard.output.board_id === 3);

  const seeded = await seedSim({
    board_id: 3,
    pins: [{ pin: 22, level: false }, { pin: 23, fault: 'write_fails' }],
    registers: [{ address: '0x48', register: '0x00', value: '17.5' }],
  }, virtualOptions);
  ok('pi_sim_seed seeds pins and registers', seeded.success && seeded.output.pins.length === 2 && seeded.output.registers.length === 1);

  const virtualDiscover = await discoverBoard({ board_id: 3 }, virtualOptions);
  ok('pi_board_discover (virtual) synthesizes seeded state', virtualDiscover.output.pin_count === 2 && virtualDiscover.output.i2c_addresses.includes('0x48'));

  await configurePin({ board_id: 3, pin: 22, mode: 'out', role: 'status LED' }, virtualOptions);
  await configurePin({ board_id: 3, pin: 23, mode: 'out', role: 'relay channel 1', is_actuator: true }, virtualOptions);

  const virtualBlocked = await writeGpio({ board_id: 3, pin: 22, level: true }, virtualOptions);
  ok('pi_gpio_write (virtual) blocks without approval', virtualBlocked.output.blocked === true);
  const virtualWritten = await writeGpio({ board_id: 3, pin: 22, level: true, approved: true }, virtualOptions);
  ok('pi_gpio_write (virtual) executes with approval', virtualWritten.output.blocked === false);
  const virtualRead = await readGpio({ board_id: 3, pin: 22 }, virtualOptions);
  ok('pi_gpio_read (virtual) reflects the simulated write', virtualRead.output.level === 1);

  let faultThrew = false;
  try {
    await writeGpio({ board_id: 3, pin: 23, level: true, approved: true }, virtualOptions);
  } catch {
    faultThrew = true;
  }
  ok('pi_gpio_write (virtual) honors a seeded write_fails fault even when approved', faultThrew);

  const virtualSensor = await readSensor({ board_id: 3, address: '0x48', register: '0x00' }, virtualOptions);
  ok('pi_sensor_read (virtual) returns the seeded value', virtualSensor.output.raw === '17.5');

  await recordAction({ board_id: 3, action: 'done', status: 'completed', value_summary: 'ci scenario complete' }, virtualOptions);

  const report = await reportBoard({ board_id: 3 }, virtualOptions);
  ok('pi_board_report returns PI_HANDOFF', report.success && report.output.markdown.startsWith('PI_HANDOFF'));
  ok('pi_board_report reports the virtual target', report.output.markdown.includes('virtual:ci-bench'));
  ok('pi_board_report clears the weak-handoff threshold', report.output.markdown.length >= 700);
  ok('pi_board_report lists the actuator pin', report.output.markdown.includes('[actuator: real-world effect]'));

  const diagram = await diagramBoard({ board_id: 3 }, virtualOptions);
  ok('pi_board_diagram returns mermaid source', diagram.success && diagram.output.format === 'mermaid' && diagram.output.mermaid.startsWith('flowchart'));
  ok('pi_board_diagram groups pins by mode subgraph', diagram.output.mermaid.includes('subgraph MODE_OUT'));
  ok('pi_board_diagram flags the actuator pin', diagram.output.mermaid.includes('class PIN_23') && /class PIN_23\S* actuator/.test(diagram.output.mermaid));
  ok('pi_board_diagram counts pins and actuators', diagram.output.pin_count === 2 && diagram.output.actuator_count === 1);
  ok('pi_board_diagram wraps a fenced mermaid block', diagram.output.markdown.startsWith('```mermaid\n') && diagram.output.markdown.trim().endsWith('```'));

  // ===================== ADVISORS =====================
  const advisorOptions = { state: Promise.resolve(state), workspaceRoot: process.cwd() };

  const llmTiny = await advisorLlm({ ram_gb: 2 }, advisorOptions);
  ok('pi_llm_advisor declines a 2GB tier', llmTiny.success && llmTiny.output.recommendation.viable === false);

  const llm8gb = await advisorLlm({ ram_gb: 8, use_case: 'chat' }, advisorOptions);
  ok('pi_llm_advisor recommends a viable setup at 8GB', llm8gb.output.recommendation.viable === true);
  ok('pi_llm_advisor mentions an 8B-class model at 8GB', /8b/i.test(llm8gb.output.recommendation.model_size_class));
  ok('pi_llm_advisor advises swap at 8GB', /swap|zram/i.test(llm8gb.output.recommendation.swap_advice));

  const osHomeAssistant = await advisorOs({ ram_gb: 8, workload: 'home-assistant' }, advisorOptions);
  ok('pi_os_advisor recommends HAOS or a container route for home-assistant', /Home Assistant/i.test(osHomeAssistant.output.recommendation.image) || /Home Assistant/i.test(osHomeAssistant.output.recommendation.alternative || ''));
  ok('pi_os_advisor flags the NVMe M.2 HAT caveat when it resolves to nvme', osHomeAssistant.output.recommendation.boot_media === 'nvme' && osHomeAssistant.output.recommendation.boot_media_notes.some(n => /M\.2 HAT/i.test(n)));

  const ramBoard = await connectBoard({ name: 'llm-box', target_kind: 'virtual', ram_gb: 16 }, virtualOptions);
  ok('pi_board_connect accepts a declared ram_gb', ramBoard.success);
  const llmFromBoard = await advisorLlm({ board_id: ramBoard.output.board_id }, advisorOptions);
  ok('pi_llm_advisor resolves ram_gb from the board when no override is passed', llmFromBoard.output.ram_gb === 16);

  let missingRamThrew = false;
  try {
    await advisorLlm({}, advisorOptions);
  } catch {
    missingRamThrew = true;
  }
  ok('pi_llm_advisor requires ram_gb when no board/override provides it', missingRamThrew);

  const advisoryList = state.query('SELECT * FROM pi_advisories ORDER BY id ASC');
  ok('pi_advisories recorded every advisor call', advisoryList.length === 4);

  const boardReportWithAdvisories = await reportBoard({ board_id: ramBoard.output.board_id }, advisorOptions);
  ok('pi_board_report includes an Advisories section', boardReportWithAdvisories.output.markdown.includes('## Advisories'));
  ok('pi_board_report lists the board-scoped advisory', boardReportWithAdvisories.output.markdown.includes('llm_builder'));

  ok('activity stream captured the full lifecycle', state.list('pi_activity').length >= 10);
} finally {
  state.close();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nALL RASPBERRY-PI SELFTESTS PASSED');
