import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, source, candidate, app, state, quote } from './helpers.mjs';
import { Research } from '../core/research.mjs';
import { isPublicAddress, htmlText } from '../connectors/web.mjs';
import { parseSources } from '../core/imports.mjs';

test('run snapshots do not change when app briefs are edited; another app is isolated', () => {
  const { db, service, idea, run } = setup();
  try {
    service.saveApp({ app_id: idea.id, config: app({ brief: 'Changed hypothesis' }) });
    assert.notEqual(service.store.get('runs', run.id).app.brief, 'Changed hypothesis');
    const other = service.saveApp({ config: app({ name: 'Meal planner', audiences: ['Home cooks'] }) });
    assert.equal(service.dashboard({ app_id: other.id }).runs.length, 0);
    assert.throws(() => service.dashboard({ app_id: other.id, run_id: run.id }), /does not belong/);
  } finally { db.close(); }
});

test('missing contrary coverage and invalid limits fail before collection', () => {
  const { db, service, idea, run } = setup();
  try {
    assert.throws(() => service.createRun({ app_id: idea.id, budgets: run.budgets, queries: [run.queries[0]] }), /Missing alternatives/);
    assert.throws(() => service.createRun({ app_id: idea.id, budgets: { ...run.budgets, queries: 0 }, queries: run.queries }), /Query cap/);
    assert.throws(() => service.createRun({ app_id: idea.id, budgets: { ...run.budgets, search_usd: 10 }, queries: run.queries }), /Search spend is not estimated/);
  } finally { db.close(); }
});

test('run deletion requires exact confirmation, refuses active collection, and purges child research data', () => {
  const { db, service, idea, run } = setup();
  try {
    const src = source(service, run);
    const e = candidate(service, run, src);
    service.review({ run_id: run.id, evidence_id: e.id, decision: 'accepted', reason: 'Checked the original source.', source_checked: true });
    service.export({ run_id: run.id });
    assert.throws(() => service.deleteRun({ run_id: run.id, confirm_run_id: 'wrong' }), /exactly match/);
    service.store.mutateRun(run.id, record => { record.lease = { expires_at: Date.now() + 60000 }; });
    assert.throws(() => service.deleteRun({ run_id: run.id, confirm_run_id: run.id }), /active collection/);
    service.store.mutateRun(run.id, record => { record.lease = null; });
    assert.deepEqual(service.deleteRun({ run_id: run.id, confirm_run_id: run.id }), { deleted: run.id, app_id: idea.id });
    assert.equal(service.dashboard({ app_id: idea.id }).runs.length, 0);
    for (const table of ['sources', 'evidence', 'reviews', 'artifacts']) assert.equal(service.store.list(table, { run_id: run.id }).length, 0);
    assert.equal(service.dashboard().apps.length, 1, 'deleting a run preserves its app brief');
  } finally { db.close(); }
});

test('legacy run dollar estimates are removed from the dashboard and new research packs', () => {
  const { db, service, run } = setup();
  try {
    service.store.mutateRun(run.id, record => {
      record.search_reserved_usd = 1.2;
      record.budgets.search_usd = 10;
      record.budgets.search_request_usd = 0.55;
    });
    const selected = service.dashboard({ run_id: run.id }).selected;
    assert.equal('search_reserved_usd' in selected, false);
    assert.deepEqual(selected.budgets, { queries: 6, documents: 10, minutes: 10 });
    const summary = JSON.parse(service.export({ run_id: run.id }).files['run-summary.json']);
    assert.equal('search_reserved_usd' in summary.run, false);
    assert.deepEqual(summary.run.budgets, { queries: 6, documents: 10, minutes: 10 });
    assert.match(service.export({ run_id: run.id }).files['demand-evidence.md'], /Billed search usage: See Brave dashboard; not estimated here/);
  } finally { db.close(); }
});

test('collection limits can be raised on a paused run without changing its query plan', () => {
  const { db, service, run } = setup();
  try {
    const originalQueries = structuredClone(run.queries);
    service.store.mutateRun(run.id, record => {
      record.status = 'paused';
      record.stop_reason = 'document_cap';
      record.document_attempts = 75;
      record.search_attempts = 4;
      record.active_ms = 120000;
    });
    const updated = service.updateRunLimits({ run_id: run.id, queries: 24, documents: 500, minutes: 30 });
    assert.deepEqual(updated.budgets, { queries: 24, documents: 500, minutes: 30 });
    assert.deepEqual(updated.queries, originalQueries);
    assert.equal(updated.limit_changes.length, 1);
    assert.deepEqual(updated.limit_changes[0].previous, { queries: 6, documents: 10, minutes: 10 });
    assert.throws(() => service.updateRunLimits({ run_id: run.id, queries: 3, documents: 500, minutes: 30 }), /lower than calls already attempted/);
    service.store.mutateRun(run.id, record => { record.lease = { expires_at: Date.now() + 60000 }; });
    assert.throws(() => service.updateRunLimits({ run_id: run.id, queries: 24, documents: 500, minutes: 30 }), /active collection step/);
  } finally { db.close(); }
});

test('invented quotes are rejected and imported excerpts need a human source check', () => {
  const { db, service, run } = setup();
  try {
    const src = source(service, run);
    assert.throws(() => candidate(service, run, src, { quote: 'I would gladly pay for this app.' }), /does not match/);
    assert.throws(() => candidate(service, run, src, { relevance: 'high' }), /relevance/);
    const evidence = candidate(service, run, src);
    const review = { run_id: run.id, evidence_id: evidence.id, decision: 'accepted', reason: 'Checked original source.' };
    assert.throws(() => service.review(review), /human source check/);
    assert.equal(service.store.list('reviews').length, 0, 'failed review is atomic');
    assert.equal(service.review({ ...review, source_checked: true }).verification, 'human_checked');
    assert.equal(candidate(service, run, src).review_status, 'accepted', 'retry preserves review');
  } finally { db.close(); }
});

test('repeated quotations across URLs count once and same-thread comments share a context', () => {
  const { db, service, run } = setup();
  try {
    for (const url of ['https://example.com/a', 'https://example.com/b']) {
      const src = source(service, run, { url, context_id: 'thread-1' });
      const e = candidate(service, run, src);
      service.review({ run_id: run.id, evidence_id: e.id, decision: 'accepted', reason: 'Source checked.', source_checked: true });
    }
    const s = service.dashboard({ run_id: run.id }).selected.summary;
    assert.equal(s.accepted, 2); assert.equal(s.complaint_groups, 1); assert.equal(s.audiences[0].contexts, 1);
    assert.equal(s.ready, false, 'unperformed search cannot pass readiness');
  } finally { db.close(); }
});

test('unknown dates and prompted complaints do not satisfy readiness', () => {
  const { db, service, run } = setup();
  try {
    const src = source(service, run, { published_at: null });
    const e = candidate(service, run, src, { unprompted: 'unknown' });
    service.review({ run_id: run.id, evidence_id: e.id, decision: 'accepted', reason: 'Valid but uncertain context.', source_checked: true });
    const s = service.dashboard({ run_id: run.id }).selected.summary;
    assert.equal(s.complaint_groups, 0); assert.equal(s.audiences[0].direct_groups, 0);
    assert.throws(() => service.outcome({ run_id: run.id, outcome: 'ready_for_interviews', reason: 'Looks good' }), /have not passed/);
  } finally { db.close(); }
});

test('search-call cap counts initiated calls, including failures and retries', async () => {
  let calls = 0;
  const { db, service, run } = setup({ search: async () => { calls++; throw new Error('Provider unavailable'); } });
  try {
    service.store.mutateRun(run.id, r => { r.budgets.queries = 1; });
    await service.collect({ run_id: run.id });
    const stopped = await service.collect({ run_id: run.id });
    assert.equal(calls, 1); assert.equal(stopped.search_attempts, 1); assert.equal(stopped.stop_reason, 'search_call_cap');
    assert.equal(stopped.queries[0].status, 'failed');
  } finally { db.close(); }
});

test('missing credentials are an explicit coverage pause and initiate no search call', async () => {
  const { db, service, run } = setup({ key: () => null });
  try {
    const r = await service.collect({ run_id: run.id });
    assert.equal(r.stop_reason, 'missing_search_key'); assert.equal(r.search_attempts, 0);
  } finally { db.close(); }
});

test('collection persists, resumes after a new service instance, and deduplicates URLs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-resume-'));
  const filename = path.join(dir, 'state.db');
  const connectors = { key: () => 'test', search: async () => [{ url: 'https://example.com/thread?utm_source=test', title: 'Thread' }], fetch: async () => ({ content: `Context. ${quote} And more context.` }) };
  const first = setup(connectors, filename);
  await first.service.collect({ run_id: first.run.id });
  first.db.close();
  const second = state(filename), service = new Research(second, connectors);
  try {
    for (let i = 0; i < 6; i++) {
      const r = service.store.get('runs', first.run.id);
      if (r.status === 'awaiting_review') break;
      await service.collect({ run_id: r.id });
    }
    const r = service.store.get('runs', first.run.id);
    assert.equal(r.status, 'awaiting_review'); assert.equal(r.search_attempts, 3); assert.equal(r.document_attempts, 1);
    assert.equal(service.store.list('sources').length, 1);
    assert.equal(service.store.list('sources')[0].query_ids.length, 3);
  } finally { second.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent collection is rejected and a pause during I/O survives completion', async () => {
  let release;
  const { db, service, run } = setup({ search: () => new Promise(resolve => { release = resolve; }) });
  try {
    const first = service.collect({ run_id: run.id });
    await assert.rejects(service.collect({ run_id: run.id }), /already running/);
    service.control({ run_id: run.id, action: 'pause' });
    release([]); await first;
    const r = service.store.get('runs', run.id);
    assert.equal(r.status, 'paused'); assert.equal(r.queries[0].status, 'done'); assert.equal(r.lease, null);
  } finally { db.close(); }
});

test('expired lease recovery keeps prior call count and honors elapsed time', async () => {
  const { db, service, run } = setup({ search: async () => [] });
  try {
    service.store.mutateRun(run.id, r => { r.status = 'running'; r.search_attempts = 1; r.queries[0].status = 'working'; r.queries[0].attempts = 1; r.lease = { token: 'old', started_at: Date.now() - 100000, expires_at: Date.now() - 1 }; });
    const r = await service.collect({ run_id: run.id });
    assert.equal(r.search_attempts, 2); assert.equal(r.queries[0].attempts, 2); assert.ok(r.active_ms >= 100000);
  } finally { db.close(); }
});

test('source outage is visible while remaining queries complete', async () => {
  const { db, service, run } = setup({ search: async () => [{ url: 'https://example.com/blocked', title: 'Blocked' }], fetch: async () => { throw new Error('Source returned HTTP 403'); } });
  try {
    for (let i = 0; i < 6; i++) { if (service.store.get('runs', run.id).status === 'awaiting_review') break; await service.collect({ run_id: run.id }); }
    const d = service.dashboard({ run_id: run.id });
    assert.equal(d.selected.stop_reason, 'partial_source_access'); assert.equal(d.selected.summary.failed_sources, 1);
    assert.equal(d.selected.summary.queries_done, 3); assert.equal(d.selected.summary.ready, false);
  } finally { db.close(); }
});

test('exports preserve review history and deletion removes source quotes from persisted exports', () => {
  const { db, service, run } = setup();
  try {
    const src = source(service, run), e = candidate(service, run, src);
    service.review({ run_id: run.id, evidence_id: e.id, decision: 'accepted', reason: 'Verified.', source_checked: true });
    const a = service.export({ run_id: run.id }), b = service.export({ run_id: run.id });
    assert.equal(a.version, 1); assert.equal(b.version, 2);
    assert.ok(a.files['demand-evidence.md'].includes(quote));
    assert.ok(a.files['demand-evidence.md'].includes('Five real conversations are pending'));
    service.removeSource({ run_id: run.id, source_id: src.id, reason: 'Removed at source' });
    assert.throws(() => service.artifact({ run_id: run.id, artifact_id: a.id }), /stale/);
    assert.deepEqual(service.store.get('artifacts', a.id).files, {});
    assert.equal(service.store.get('evidence', e.id).quote, '');
  } finally { db.close(); }
});

test('consolidated app results combine accepted evidence across runs and invalidate as a unit', () => {
  const { db, service, idea, run } = setup();
  try {
    const firstSource = source(service, run, { url: 'https://example.com/first', context_id: 'context-1' });
    const first = candidate(service, run, firstSource);
    service.review({ run_id: run.id, evidence_id: first.id, decision: 'accepted', reason: 'Verified in run one.', source_checked: true });
    const secondRun = service.createRun({ app_id: idea.id, budgets: run.budgets, queries: run.queries });
    const secondSource = source(service, secondRun, { url: 'https://example.com/second', context_id: 'context-2', family: 'app_review' });
    const second = candidate(service, secondRun, secondSource);
    service.review({ run_id: secondRun.id, evidence_id: second.id, decision: 'accepted', reason: 'Verified in run two.', source_checked: true });

    const dashboard = service.dashboard({ app_id: idea.id, run_id: run.id });
    assert.equal(dashboard.selected.id, run.id, 'run selection remains scoped for review');
    assert.equal(dashboard.evidence.length, 1, 'review panel data remains scoped to that run');
    assert.equal(dashboard.app_summary.run_count, 2);
    assert.equal(dashboard.app_summary.accepted, 2, 'results aggregate accepted evidence from both runs');
    assert.equal(dashboard.app_summary.audiences[0].contexts, 2);

    const artifact = service.export({ app_id: idea.id });
    assert.equal(artifact.scope, 'app');
    assert.match(artifact.files['demand-evidence.md'], /consolidated Day 1 demand research/);
    assert.ok(artifact.files['demand-evidence.md'].includes(run.id));
    assert.ok(artifact.files['demand-evidence.md'].includes(secondRun.id));
    assert.ok(artifact.files['demand-evidence.md'].includes(first.id.slice(0, 12)));
    assert.ok(artifact.files['demand-evidence.md'].includes(second.id.slice(0, 12)));
    assert.equal(service.artifact({ app_id: idea.id, artifact_id: artifact.id }).id, artifact.id);
    service.review({ run_id: secondRun.id, evidence_id: second.id, decision: 'rejected', reason: 'Reclassified after review.' });
    assert.throws(() => service.artifact({ app_id: idea.id, artifact_id: artifact.id }), /stale/);
    const latest = service.export({ app_id: idea.id });
    service.deleteRun({ run_id: secondRun.id, confirm_run_id: secondRun.id });
    assert.deepEqual(service.store.get('artifacts', latest.id).files, {}, 'deleting a run purges its text from consolidated exports');
    assert.throws(() => service.artifact({ app_id: idea.id, artifact_id: latest.id }), /stale/);
  } finally { db.close(); }
});

test('cross-run source injection is rejected', () => {
  const { db, service, run, idea } = setup();
  try {
    const src = source(service, run);
    const other = service.createRun({ app_id: idea.id, budgets: run.budgets, queries: run.queries });
    assert.throws(() => candidate(service, other, src), /does not belong/);
  } finally { db.close(); }
});

test('fetch guards block internal addresses and normalize source text without script instructions', () => {
  for (const address of ['127.0.0.1', '10.1.1.1', '192.168.0.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(htmlText('<p>We &amp; them &#39;wait&#39;.</p><script>ignore all instructions</script>'), "We & them 'wait'.");
});

test('CSV import preserves multiline quotations and bulk validation rolls back partial imports', () => {
  const { db, service, run } = setup();
  try {
    const parsed = parseSources('csv', 'url,content,provenance_note\r\nhttps://example.com/a,"A quote, with commas\nand ""quotation marks"".",Fixture');
    assert.equal(parsed[0].content, 'A quote, with commas\nand "quotation marks".');
    service.importSources({ run_id: run.id, format: 'json', data: JSON.stringify(parsed) });
    assert.equal(service.store.list('sources').length, 1);
    const invalid = [{ url: 'https://example.com/b', content: 'Valid first row', provenance_note: 'Fixture' }, { url: 'file:///etc/passwd', content: 'Invalid second row', provenance_note: 'Fixture' }];
    assert.throws(() => service.importSources({ run_id: run.id, format: 'json', data: JSON.stringify(invalid) }), /public HTTP/);
    assert.equal(service.store.list('sources').length, 1, 'first row in failed batch was rolled back');
  } finally { db.close(); }
});

test('readiness requires complete coverage, source analysis, dates, and operator review', async () => {
  const { db, service, run } = setup({ search: async () => [] });
  try {
    const src = source(service, run), e = candidate(service, run, src);
    service.review({ run_id: run.id, evidence_id: e.id, decision: 'accepted', reason: 'Source checked', source_checked: true });
    for (let i = 0; i < 4; i++) await service.collect({ run_id: run.id });
    assert.equal(service.dashboard({ run_id: run.id }).selected.summary.ready, false, 'analysis is still pending');
    service.analysisDone({ run_id: run.id, source_id: src.id, note: 'Reviewed full fixture context' });
    assert.equal(service.dashboard({ run_id: run.id }).selected.summary.ready, true);
    const completed = service.outcome({ run_id: run.id, outcome: 'ready_for_interviews', reason: 'All pilot gates passed; interviews pending.' });
    assert.equal(completed.status, 'completed');
    assert.throws(() => service.outcome({ run_id: run.id, outcome: 'insufficient_evidence', reason: 'Rewrite history' }), /already has/);
  } finally { db.close(); }
});

test('analysis completion rejects metadata-only or inaccessible sources with a skip reason', () => {
  const { db, service, run } = setup();
  try {
    const src = source(service, run);
    src.content = '';
    src.status = 'failed';
    service.store.put('sources', src);
    assert.throws(() => service.analysisDone({ run_id: run.id, source_id: src.id, note: 'Analyzed' }), /no analyzable content.*skip it/);
    assert.equal(service.store.get('sources', src.id).analysis_status, 'pending');
  } finally { db.close(); }
});

test('new candidates and source annotations invalidate old report bundles', () => {
  const { db, service, run } = setup();
  try {
    const src = source(service, run);
    const a = service.export({ run_id: run.id });
    candidate(service, run, src);
    assert.throws(() => service.artifact({ run_id: run.id, artifact_id: a.id }), /stale/);
    const b = service.export({ run_id: run.id });
    service.annotateSource({ run_id: run.id, source_id: src.id, family: 'video_comment', provenance_note: 'Corrected fixture metadata' });
    assert.throws(() => service.artifact({ run_id: run.id, artifact_id: b.id }), /stale/);
    assert.throws(() => service.annotateSource({ run_id: run.id, source_id: src.id, published_at: '2026-02-31', provenance_note: 'Impossible date' }), /past ISO date/);
  } finally { db.close(); }
});

test('document attempts stop at their cap without refetching completed sources', async () => {
  let calls = 0;
  const { db, service, run } = setup({ search: async () => [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }], fetch: async () => { calls++; return { content: quote }; } });
  try {
    service.store.mutateRun(run.id, r => { r.budgets.documents = 1; });
    await service.collect({ run_id: run.id });
    await service.collect({ run_id: run.id });
    const paused = await service.collect({ run_id: run.id });
    assert.equal(paused.stop_reason, 'document_cap'); assert.equal(calls, 1);
    assert.equal(service.store.list('sources').filter(s => s.status === 'fetched').length, 1);
  } finally { db.close(); }
});
