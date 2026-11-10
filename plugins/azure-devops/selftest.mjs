/**
 * Selftest for azure-devops.
 *
 * Every test injects a fake `fetch` through `deps`. Nothing reaches the
 * network, and no PAT is needed — but the request shape (method, path,
 * api-version, JSON Patch body) and the approval gate are exercised for
 * real.
 *
 * Run: node selftest.mjs
 */

import { getAdoConfig, resolveProject } from './tools/lib.mjs';
import { call as getWorkItem } from './tools/get-work-item.mjs';
import { call as addComment } from './tools/add-comment.mjs';
import { call as updateComment } from './tools/update-comment.mjs';
import { call as createWorkItem } from './tools/create-work-item.mjs';
import { call as updateWorkItem } from './tools/update-work-item.mjs';

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function makeState(config) {
  return {
    sql: [],
    query(sql, params = []) {
      this.sql.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/last_insert_rowid/.test(sql)) return [{ id: this.sql.filter((e) => /INSERT INTO ado_actions/.test(e.sql)).length }];
      return [];
    },
    getConfig(key) { return config[key] ?? null; },
    getAllConfig() { return config; },
    rowsFor(table) { return this.sql.filter((entry) => entry.sql.startsWith(`INSERT INTO ${table}`)); },
  };
}

const EMPTY = {};
const FULL = { organization: 'contoso', project: 'demo', personal_access_token: 'shh-pat' };

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  text: async () => JSON.stringify(body),
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    let body = null;
    if (typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch { body = options.body; }
    }
    calls.push({ url, method: options.method ?? 'GET', headers: options.headers || {}, body });
    for (const [pattern, responder] of routes) {
      if (url.includes(pattern)) return typeof responder === 'function' ? responder(url, options) : responder;
    }
    return json({ message: `no fake route for ${url}` }, 404);
  };
  impl.calls = calls;
  return impl;
}

console.log('\nconfig handling');
{
  const cfg = getAdoConfig(makeState(EMPTY));
  ok('reports missing org and PAT', cfg.ready === false && cfg.missing.includes('organization') && cfg.missing.includes('personal_access_token'));
  const full = getAdoConfig(makeState(FULL));
  ok('accepts a complete config', full.ready === true && full.organization === 'contoso');

  const noProject = resolveProject({ project: null }, undefined);
  ok('fails without any project', noProject.ok === false);
  ok('an explicit project wins over the default', resolveProject({ project: 'configured' }, 'explicit').project === 'explicit');
  ok('falls back to the configured default', resolveProject({ project: 'configured' }, undefined).project === 'configured');
}

console.log('\nevery tool refuses to run unconfigured');
for (const [name, tool, args] of [
  ['getWorkItem', getWorkItem, { id: 1 }],
  ['addComment', addComment, { work_item_id: 1, text: 'hi' }],
  ['updateComment', updateComment, { work_item_id: 1, comment_id: 1, text: 'hi' }],
  ['createWorkItem', createWorkItem, { type: 'Bug', title: 'x' }],
  ['updateWorkItem', updateWorkItem, { work_item_id: 1, fields: { 'System.State': 'Closed' } }],
]) {
  const result = await tool(args, { state: makeState(EMPTY) });
  ok(`${name} fails cleanly with no credentials`, result.success === false && /not configured/.test(String(result.output)));
}

console.log('\nado_get_work_item reads by field name, no state write');
{
  const fetchImpl = fakeFetch([['_apis/wit/workitems/42', json({
    id: 42,
    fields: { 'System.WorkItemType': 'Bug', 'System.Title': 'Login fails', 'System.State': 'Active' },
  })]]);
  const state = makeState(FULL);
  const result = await getWorkItem({ id: 42 }, { state, deps: { fetch: fetchImpl } });
  ok('succeeds', result.success === true);
  ok('reads the title', result.output.title === 'Login fails');
  ok('builds the ADO url', result.output.url === 'https://dev.azure.com/contoso/demo/_workitems/edit/42');
  ok('records nothing', state.sql.length === 0);
}

console.log('\nado_add_comment posts and records');
{
  const fetchImpl = fakeFetch([['comments', json({ id: 7, text: 'Looked into this.' })]]);
  const state = makeState(FULL);
  const result = await addComment({ work_item_id: 42, text: 'Looked into this.' }, { state, deps: { fetch: fetchImpl } });

  ok('succeeds', result.success === true);
  ok('returns the comment id', result.output.comment_id === 7);

  const call = fetchImpl.calls.find((c) => c.url.includes('comments'));
  ok('posts to the work item comments endpoint', call.method === 'POST' && call.url.includes('workItems/42/comments'));
  ok('sends the comment text', call.body.text === 'Looked into this.');
  ok('authenticates with Basic auth, never the raw PAT in the URL', !call.url.includes('shh-pat') && /^Basic /.test(call.headers.Authorization));

  const rows = state.rowsFor('ado_actions');
  ok('recorded exactly one action', rows.length === 1);
  ok('recorded action links back to the item', String(rows[0].params[7]).includes('/edit/42'));
  ok('recorded as completed', rows[0].params[8] === 'completed');
}

console.log('\nado_update_comment patches the existing comment');
{
  const fetchImpl = fakeFetch([['comments/7', json({})]]);
  const result = await updateComment(
    { work_item_id: 42, comment_id: 7, text: 'Correction: fixed in build 412.' },
    { state: makeState(FULL), deps: { fetch: fetchImpl } },
  );
  ok('succeeds', result.success === true);
  const call = fetchImpl.calls.find((c) => c.url.includes('comments/7'));
  ok('PATCHes the specific comment', call.method === 'PATCH');
  ok('sends the new text', call.body.text === 'Correction: fixed in build 412.');
}

console.log('\nado_create_work_item sends a JSON Patch body to $Type');
{
  const fetchImpl = fakeFetch([['workitems/$Bug', json({ id: 99 })]]);
  const result = await createWorkItem(
    { type: 'Bug', title: 'Crash on save', description: 'Repro steps...', tags: ['p1', 'regression'] },
    { state: makeState(FULL), deps: { fetch: fetchImpl } },
  );
  ok('succeeds', result.success === true, JSON.stringify(result.output));
  ok('returns the new id', result.output.work_item_id === 99);

  const call = fetchImpl.calls.find((c) => c.url.includes('workitems/$Bug'));
  ok('posts a JSON Patch array', Array.isArray(call.body) && call.body[0].op === 'add');
  ok('sets the title', call.body.find((p) => p.path === '/fields/System.Title').value === 'Crash on save');
  ok('joins tags with semicolons', call.body.find((p) => p.path === '/fields/System.Tags').value === 'p1; regression');
}

console.log('\nado_update_work_item holds for approval, then proceeds once approved');
{
  const fetchImpl = fakeFetch([['_apis/wit/workitems/42', json({})]]);
  const state = makeState(FULL);

  const proposed = await updateWorkItem(
    { work_item_id: 42, fields: { 'System.State': 'Removed' }, requires_approval: true },
    { state, deps: { fetch: fetchImpl } },
  );
  ok('refuses to act without approval', proposed.success === false && proposed.output.needs_approval === true);
  ok('does not call Azure DevOps yet', fetchImpl.calls.length === 0);
  ok('records the proposal as needs_approval', state.rowsFor('ado_actions')[0].params[8] === 'needs_approval');

  const applied = await updateWorkItem(
    { work_item_id: 42, fields: { 'System.State': 'Removed' }, requires_approval: true, approved: true },
    { state, deps: { fetch: fetchImpl } },
  );
  ok('proceeds once approved', applied.success === true);
  ok('calls Azure DevOps exactly once', fetchImpl.calls.length === 1);
  ok('PATCHes the work item', fetchImpl.calls[0].method === 'PATCH');
  ok('records the applied change as approved', state.rowsFor('ado_actions')[1].params[8] === 'approved');
}

console.log('\nordinary field updates with no approval flag go straight through');
{
  const fetchImpl = fakeFetch([['_apis/wit/workitems/42', json({})]]);
  const state = makeState(FULL);
  const result = await updateWorkItem(
    { work_item_id: 42, fields: { 'System.AssignedTo': 'dev@example.com' } },
    { state, deps: { fetch: fetchImpl } },
  );
  ok('succeeds immediately', result.success === true);
  ok('recorded as completed, not needs_approval', state.rowsFor('ado_actions')[0].params[8] === 'completed');
}

console.log('\nfailures surface, never become a silent success');
{
  const fetchImpl = fakeFetch([['comments', json({ message: 'TF401349: field does not exist' }, 400)]]);
  const result = await addComment({ work_item_id: 42, text: 'x' }, { state: makeState(FULL), deps: { fetch: fetchImpl } });
  ok('a 400 fails the tool', result.success === false);
  ok('surfaces Azure DevOps\'s own message', /TF401349/.test(String(result.output)));
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
await import('./selftest-extended.mjs');
