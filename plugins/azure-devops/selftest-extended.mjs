import assert from 'node:assert/strict';
import { call as discover } from './tools/discover.mjs';
import { call as query } from './tools/query-work-items.mjs';
import { call as sprint } from './tools/sprint.mjs';
import { call as pipelines } from './tools/pipelines.mjs';
import { call as prs } from './tools/pull-requests.mjs';
import { call as update } from './tools/update-work-item.mjs';
import { call as getItem } from './tools/get-work-item.mjs';
import { call as create } from './tools/create-work-item.mjs';

// Hosted tools receive configuration and an authenticated request capability.
// No secret is present in the plugin state or connection object.
const config = { organization: 'contoso', project: 'Project One', team: 'Team One', locked_project: 'Project One', locked_team: 'Team One' };
const state = { getConfig: () => null, query: () => [] };
const calls = [];
let respond = () => ({});
const connection = { config, request: async req => { calls.push(req); return respond(req); } };
const options = { state, connection };
const clear = () => { calls.length = 0; };

assert.equal((await discover({ resource: 'projects' }, options)).success, true);
assert.equal(calls[0].path, '_apis/projects/Project%20One');
clear();
assert.equal((await discover({ resource: 'members', team: 'Other' }, options)).success, false);
assert.equal((await query({ project: 'Other' }, options)).success, false);
assert.equal((await update({ work_item_id: 1, fields: { 'System.TeamProject': 'Other' } }, options)).success, false);
assert.equal(calls.length, 0);

respond = req => req.path.includes('/wiql') ? { workItems: [{ id: 42 }] }
  : { value: [{ id: 42, fields: { 'System.Title': 'Test', 'System.State': 'Active' } }] };
const result = await query({ mine: true, search: "a' OR 1=1", limit: 10 }, options);
assert.equal(result.success, true);
assert.match(calls[0].body.query, /\[System.TeamProject\] = 'Project One'/);
assert.match(calls[0].body.query, /\[System.AssignedTo\] = @Me/);
assert.match(calls[0].body.query, /CONTAINS 'a'' OR 1=1'/);
assert.equal(result.output.items[0].id, 42);
assert.equal((await query({ limit: 201 }, options)).success, false);
clear();
respond = () => ({ workItems: [] });
assert.deepEqual((await query({}, options)).output.items, []);
assert.equal(calls.length, 1);

clear();
respond = req => {
  if (req.path.includes('$timeframe')) return { value: [{ id: 'sprint-1', name: 'Sprint 1' }] };
  if (req.path.endsWith('/workitems')) return { workItemRelations: Array.from({ length: 201 }, (_, i) => ({ target: { id: i + 1 } })) };
  return { value: req.body.ids.map(id => ({ id, fields: { 'System.Title': `Task ${id}`, 'System.State': 'Active' } })) };
};
const current = await sprint({}, options);
assert.equal(current.output.total, 201);
assert.equal(current.output.by_state.Active, 201);
assert.equal(current.output.by_assignee.Unassigned, 201);
assert.equal(calls.filter(req => req.method === 'POST').length, 2);
assert.match(calls[0].path, /^Project%20One\/Team%20One\//);

clear();
respond = () => ({ id: 21 });
assert.equal((await pipelines({ action: 'run', pipeline_id: 8, branch: 'refs/heads/main' }, options)).success, true);
assert.equal(calls[0].body.resources.repositories.self.refName, 'refs/heads/main');
assert.equal((await pipelines({ action: 'run', pipeline_id: -1 }, options)).success, false);
clear();
respond = () => ({ pullRequestId: 7 });
assert.equal((await prs({ action: 'create', repository: 'repo', title: 'Fix', source_branch: 'refs/heads/fix', target_branch: 'refs/heads/main' }, options)).success, true);
assert.equal(calls[0].method, 'POST');
assert.equal(calls[0].body.targetRefName, 'refs/heads/main');
assert.equal((await prs({ action: 'create', repository: 'repo', title: 'Fix', source_branch: 'fix', target_branch: 'main' }, options)).success, false);
clear();
for (const id of [0, -1, 1.5, Infinity, 'x']) assert.equal((await getItem({ id }, options)).success, false);
assert.equal((await update({ work_item_id: 1, fields: { '../bad': 'x' } }, options)).success, false);
assert.equal((await update({ work_item_id: 1, fields: ['bad'] }, options)).success, false);
assert.equal(calls.length, 0);

respond = () => ({ id: 7 });
await create({ type: 'Bug', title: 'A', area_path: 'Project One\\API', iteration_path: 'Project One\\Sprint 1' }, options);
assert.equal(calls[0].body.find(p => p.path === '/fields/System.AreaPath').value, 'Project One\\API');
const controller = new AbortController();
controller.abort();
clear();
await getItem({ id: 7 }, { ...options, signal: controller.signal });
assert.equal(calls[0].signal, controller.signal);
console.log('Extended ADO tests passed: scoped connection, discovery, queries, sprint batching, pipelines, PRs, validation and cancellation.');
