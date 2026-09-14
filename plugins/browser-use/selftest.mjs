import { DatabaseSync } from 'node:sqlite';
import { call as createSession } from './tools/browser-session-create.mjs';
import { call as discoverForm } from './tools/browser-form-discover.mjs';
import { call as createProfile } from './tools/form-profile-create.mjs';
import { call as fillPlan } from './tools/form-fill-plan.mjs';
import { call as recordAction } from './tools/browser-action-record.mjs';
import { call as browserFormComplete } from './tools/browser-form-complete.mjs';
import { call as browserFormFill } from './tools/browser-form-fill.mjs';
import { call as reportSession } from './tools/browser-session-report.mjs';

let failures = 0;
function ok(label, cond) {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
}

const DDL = `
CREATE TABLE browser_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE form_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  redactions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE browser_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  selector TEXT NOT NULL DEFAULT '',
  value_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
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

const state = makeState();
function mockPlaywright() {
  const actions = [];
  const makeLocator = selector => ({
    first() { return this; },
    async count() { return selector === '#missing' ? 0 : 1; },
    async evaluate(fn) {
      const type = selector.includes('terms') ? 'checkbox' : selector.includes('state') ? '' : 'text';
      const tagName = selector.includes('state') ? 'SELECT' : 'INPUT';
      return fn({ tagName, getAttribute: name => name === 'type' ? type : '' });
    },
    async fill(value) { actions.push(['fill', selector, value]); },
    async selectOption(value) { actions.push(['select', selector, value]); },
    async check() { actions.push(['check', selector]); },
    async uncheck() { actions.push(['uncheck', selector]); },
    async click() { actions.push(['click', selector]); },
  });
  return {
    actions,
    chromium: {
      async launch() {
        return {
          async newPage() {
            return {
              async goto(url) { actions.push(['goto', url]); },
              on() {},
              locator: makeLocator,
              async screenshot({ path }) { actions.push(['screenshot', path]); },
              async waitForLoadState() { actions.push(['waitForLoadState']); },
              async waitForTimeout(ms) { actions.push(['waitForTimeout', ms]); },
              async evaluate(_fn, key) {
                actions.push(['evaluate', key]);
                if (key === undefined) {
                  return {
                    title: 'Support',
                    url: 'https://www.bahulam.ai/support',
                    visible_text_sample: 'Support Name Email Category Product Subject Message Send to support',
                    controls: [
                      { tag: 'input', type: 'text', name: 'name', id: 'name', label: 'Name', selector: '#name', required: true },
                      { tag: 'input', type: 'email', name: 'email', id: 'email', label: 'Email', selector: '#email', required: true },
                      { tag: 'select', type: 'select', name: 'category', id: 'category', label: 'Category', selector: '#category', required: true, options: [{ value: 'technical', label: 'Technical' }] },
                      { tag: 'textarea', type: 'textarea', name: 'message', id: 'message', label: 'Message', selector: '#message', required: true },
                    ],
                    buttons: [{ tag: 'button', type: 'submit', text: 'Send to support', selector: '#submitBtn' }],
                  };
                }
                return '[{\"id\":\"sample\"}]';
              },
            };
          },
          async close() { actions.push(['close']); },
        };
      },
    },
  };
}

const playwright = mockPlaywright();
const options = { state: Promise.resolve(state), playwright, workspaceRoot: process.cwd() };
try {
  const session = await createSession({
    name: 'vendor onboarding',
    url: 'https://example.com/vendor',
    purpose: 'Fill company onboarding form and stop before submit.',
  }, options);
  ok('browser_session_create succeeds', session.success && session.output.session_id === 1);
  ok('runtime state tracks active session', state.get('browser_runtime_state').active_session_id === 1);
  const reusedSession = await createSession({
    name: 'vendor onboarding duplicate',
    url: 'https://example.com/vendor',
    purpose: 'Continue filling the same form.',
  }, options);
  ok('browser_session_create reuses active matching session', reusedSession.output.session_id === 1 && reusedSession.output.reused === true);
  const forcedSession = await createSession({
    name: 'vendor onboarding fresh',
    url: 'https://example.com/vendor',
    purpose: 'Start a fresh form session.',
    force_new: true,
  }, options);
  ok('browser_session_create can force a new session', forcedSession.output.session_id === 2 && !forcedSession.output.reused);

  const discovered = await discoverForm({ session_id: 1, wait_ms: 0 }, options);
  ok('browser_form_discover succeeds', discovered.success && discovered.output.control_count === 4);
  ok('browser_form_discover captures buttons', discovered.output.buttons[0].text === 'Send to support');

  const profile = await createProfile({
    session_id: 1,
    label: 'Company profile',
    fields: [
      { name: 'Company name', selector: '#company', value: 'Tarang', source: 'user' },
      { name: 'State', selector: '#state', value: 'CA', source: 'user' },
      { name: 'Terms', selector: '#terms', value: 'true', source: 'user' },
      { name: 'Tax id', selector: '#tax-id', value: '12-3456789', sensitive: true, source: 'secret' },
    ],
    redactions: ['Tax id'],
  }, options);
  ok('form_profile_create succeeds', profile.success && profile.output.profile_id === 1);
  ok('sensitive field is redacted', !JSON.stringify(state.query('SELECT fields_json FROM form_profiles')[0]).includes('12-3456789'));

  const plan = await fillPlan({ session_id: 1, profile_id: 1, include_submit: true }, options);
  ok('form_fill_plan succeeds', plan.success && plan.output.steps.length === 6);
  ok('submit step is approval-gated', plan.output.steps.at(-1).requires_approval === true);

  const complete = await browserFormComplete({
    name: 'vendor onboarding complete',
    url: 'https://example.com/vendor',
    purpose: 'Fill form in one lifecycle.',
    fields: [
      { name: 'Company name', selector: '#company', value: 'Tarang', source: 'user' },
      { name: 'State', selector: '#state', value: 'CA', source: 'user' },
      { name: 'Terms', selector: '#terms', value: 'true', source: 'user' },
    ],
    submit: false,
    keep_open: false,
    wait_ms: 0,
  }, options);
  ok('browser_form_complete succeeds', complete.success && complete.output.filled.length === 3);
  ok('browser_form_complete records user-submit handoff', complete.output.handoff?.mode === 'user_submit');

  const blockedFill = await browserFormFill({ session_id: 1, profile_id: 1, submit: true, local_storage_key: 'bahulam.browserUseTest.submissions' }, options);
  ok('browser_form_fill fills fields', blockedFill.success && blockedFill.output.filled.length === 4);
  ok('browser_form_fill blocks submit without approval', blockedFill.output.submitted === false);
  ok('browser_form_fill reads localStorage', blockedFill.output.storage_value === '[{\"id\":\"sample\"}]');
  ok('browser_form_fill reports storage found', blockedFill.output.storage_found === true);

  const handoffFill = await browserFormFill({ session_id: 1, profile_id: 1 }, options);
  ok('browser_form_fill defaults to user-submit handoff', handoffFill.output.handoff?.mode === 'user_submit');
  ok('browser_form_fill records manual submit gate', state.query('SELECT * FROM browser_actions WHERE action = ? AND status = ?', ['submit', 'blocked']).length >= 1);

  const action = await recordAction({
    session_id: 1,
    action: 'submit',
    status: 'planned',
    value_summary: 'waiting for user approval',
  }, options);
  ok('browser_action_record gates submit', action.success && action.output.requires_approval === true);

  const report = await reportSession({ session_id: 1 }, options);
  ok('browser_session_report returns markdown', report.success && report.output.markdown.includes('Pending approval gates'));
  ok('browser_session_report returns structured handoff', report.output.markdown.includes('BROWSER_USE_HANDOFF'));
  ok('browser_session_report clears weak handoff threshold', report.output.markdown.length >= 700);
  ok('browser_session_report instructs manual submit', report.output.markdown.includes('click Submit manually'));
  ok('activity stream captures lifecycle', state.list('browser_activity').length >= 4);
} finally {
  state.close();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nALL BROWSER-USE SELFTESTS PASSED');
