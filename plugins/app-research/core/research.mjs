import { Store, id, now } from './store.mjs';
import { appConfig, runConfig, evidenceFields, text, choice, number, canonicalUrl, hash, normalize } from './validation.mjs';
import { searchWeb, fetchSource } from '../connectors/web.mjs';
import { summarize, summarizeApp, buildReports, buildAppReports } from './reports.mjs';
import { parseSources } from './imports.mjs';

export class Research {
  constructor(state, connectors = {}) {
    this.store = new Store(state);
    this.state = state;
    this.search = connectors.search || searchWeb;
    this.fetch = connectors.fetch || fetchSource;
    this.key = connectors.key || (() => state.getConfig?.('brave_api_key') || process.env.BRAVE_API_KEY);
  }
  saveApp(args) {
    const config = appConfig(args.config);
    const previous = args.app_id ? this.store.get('apps', args.app_id) : null;
    const app = { ...config, id: previous?.id || id(), version: (previous?.version || 0) + 1, created_at: previous?.created_at || now(), updated_at: now() };
    return this.store.put('apps', app);
  }
  createRun(args) {
    const app = this.store.get('apps', args.app_id);
    const { budgets, queries } = runConfig(args, app);
    return this.store.put('runs', {
      id: id(), app_id: app.id, app: structuredClone(app), budgets: structuredClone(budgets),
      queries: queries.map(q => ({ ...q, id: id() })), status: 'queued', stop_reason: '',
      created_at: now(), updated_at: now(), search_attempts: 0,
      document_attempts: 0, active_ms: 0, lease: null, outcome: null,
      limit_changes: [], code_version: '0.1.0', prompt_version: 'day1-v1', agent_usage: 'not_metered_by_plugin',
      provider: 'brave', artifact_version: 0
    });
  }
  updateRunLimits(args) {
    const limits = {
      queries: number(args.queries, 'Search-call cap', 1, 100, true),
      documents: number(args.documents, 'Document cap', 1, 500, true),
      minutes: number(args.minutes, 'Collection time cap', 1, 240, true)
    };
    return this.store.mutateRun(args.run_id, run => {
      if (!['queued', 'paused'].includes(run.status)) {
        throw new Error('Collection is finished; limits can only be changed on a queued or paused run');
      }
      if (run.lease?.expires_at > Date.now()) throw new Error('Wait for the active collection step before changing limits');
      if (limits.queries < (run.search_attempts || 0)) throw new Error('Search-call cap cannot be lower than calls already attempted');
      if (limits.documents < (run.document_attempts || 0)) throw new Error('Document cap cannot be lower than attempts already made');
      if (limits.minutes * 60000 < (run.active_ms || 0)) throw new Error('Collection-time cap cannot be lower than time already used');
      const previous = { queries: run.budgets.queries, documents: run.budgets.documents, minutes: run.budgets.minutes };
      run.budgets = limits;
      run.limit_changes ||= [];
      run.limit_changes.push({ previous, limits, changed_at: now() });
    });
  }
  deleteRun(args) {
    const run = this.store.get('runs', args.run_id);
    if (args.confirm_run_id !== run.id) throw new Error('Run deletion requires confirm_run_id to exactly match the run ID');
    if (run.lease?.expires_at > Date.now()) throw new Error('Wait for the active collection step before deleting this run');
    return this.store.transaction(() => {
      for (const artifact of this.store.list('artifacts', { app_id: run.app_id }).filter(a => a.scope === 'app')) {
        artifact.files = {}; artifact.stale = true; artifact.deleted_run = run.id; this.store.put('artifacts', artifact);
      }
      for (const table of ['artifacts', 'reviews', 'evidence', 'sources']) {
        this.store.state.query(`DELETE FROM research_${table} WHERE run_id = ?`, [run.id]);
      }
      this.store.state.query('DELETE FROM research_runs WHERE id = ?', [run.id]);
      return { deleted: run.id, app_id: run.app_id };
    });
  }
  dashboard(args = {}) {
    const apps = this.store.list('apps');
    const runs = this.store.list('runs', args.app_id ? { app_id: args.app_id } : {}).map(r => {
      const { search_reserved_usd, ...clean } = r;
      if (clean.budgets) {
        clean.budgets = { queries: clean.budgets.queries, documents: clean.budgets.documents, minutes: clean.budgets.minutes };
      }
      return { ...clean, summary: summarize(this.store, r) };
    });
    const selected = args.run_id ? runs.find(r => r.id === args.run_id) : null;
    if (args.run_id && !selected) throw new Error('Run does not belong to selected app');
    const activeApp = apps.find(a => a.id === args.app_id) || selected?.app || null;
    const appRuns = activeApp ? runs.filter(r => r.app_id === activeApp.id) : [];
    return {
      apps, runs, selected,
      app_summary: activeApp ? summarizeApp(this.store, activeApp, appRuns) : null,
      app_artifacts: activeApp ? this.store.list('artifacts', { app_id: activeApp.id }).filter(a => a.scope === 'app').map(({ files, ...a }) => a) : [],
      sources: selected ? this.store.list('sources', { run_id: selected.id }).map(({ content, ...s }) => ({ ...s, content_chars: content?.length || 0 })) : [],
      evidence: selected ? this.store.list('evidence', { run_id: selected.id }) : [],
      reviews: selected ? this.store.list('reviews', { run_id: selected.id }) : [],
      artifacts: selected ? this.store.list('artifacts', { run_id: selected.id }).map(({ files, ...a }) => a) : [],
      connectors: { brave: Boolean(this.key()), imports: true },
      limitations: ['Brave billed usage is not estimated here; check the Brave dashboard. Agent-session usage is also not metered by this plugin.', 'Collection advances while the panel or an agent requests steps. Resume after stopping the runtime.']
    };
  }
  source(args) { return this.store.child('sources', args.source_id, args.run_id); }
  control(args) {
    return this.store.mutateRun(args.run_id, run => {
      const action = choice(args.action, ['pause', 'resume', 'cancel', 'retry_failed'], 'run action');
      if (run.status === 'completed') throw new Error('Completed runs are immutable; create a new run');
      if (action === 'pause') { run.status = 'paused'; run.stop_reason = 'operator_paused'; }
      if (action === 'cancel') { run.status = 'cancelled'; run.stop_reason = 'operator_cancelled'; }
      if (action === 'resume' || action === 'retry_failed') {
        if (run.status === 'cancelled') throw new Error('Cancelled runs cannot resume; create a new run');
        if (run.active_ms >= run.budgets.minutes * 60000) throw new Error('Collection time cap reached; create a new run with revised limits');
        if (action === 'retry_failed') {
          for (const q of run.queries) if (q.status === 'failed' && q.attempts < 2) q.status = 'pending';
          for (const s of this.store.list('sources', { run_id: run.id })) if (s.status === 'failed' && s.attempts < 2) { s.status = 'pending'; this.store.put('sources', s); }
        }
        run.status = 'queued'; run.stop_reason = '';
      }
    });
  }
  async collect(args) {
    const token = id();
    let work;
    const claimed = this.store.mutateRun(args.run_id, run => {
      if (!['queued', 'running'].includes(run.status)) throw new Error('Resume a queued run before collecting');
      if (run.lease && run.lease.expires_at > Date.now()) throw new Error('A collection step is already running');
      // A previous process may have died after dispatch. Conservatively retain its
      // reservation and elapsed lease time before any retry.
      if (run.lease) run.active_ms += Math.max(0, Date.now() - run.lease.started_at);
      if (run.active_ms >= run.budgets.minutes * 60000) { run.status = 'paused'; run.stop_reason = 'time_cap'; run.lease = null; return; }
      for (const q of run.queries) if (q.status === 'working') q.status = q.attempts < 2 ? 'pending' : 'failed';
      const sources = this.store.list('sources', { run_id: run.id });
      for (const s of sources) if (s.status === 'working') { s.status = s.attempts < 2 ? 'pending' : 'failed'; this.store.put('sources', s); }
      const source = sources.find(s => s.status === 'pending');
      const query = run.queries.find(q => q.status === 'pending');
      if (source) {
        if (run.document_attempts >= run.budgets.documents) { run.status = 'paused'; run.stop_reason = 'document_cap'; run.lease = null; return; }
        source.status = 'working'; source.attempts++; run.document_attempts++;
        this.store.put('sources', source); work = { kind: 'source', record: source };
      } else if (query) {
        if (!this.key()) { run.status = 'paused'; run.stop_reason = 'missing_search_key'; run.lease = null; return; }
        if (run.search_attempts >= run.budgets.queries) {
          run.status = 'paused'; run.stop_reason = 'search_call_cap'; run.lease = null; return;
        }
        run.search_attempts++;
        query.status = 'working'; query.attempts++;
        work = { kind: 'query', record: query };
      } else {
        run.status = 'awaiting_review'; run.stop_reason = run.queries.some(q => q.status === 'failed') || sources.some(s => s.status === 'failed') ? 'partial_source_access' : 'collection_finished';
        run.lease = null; return;
      }
      run.status = 'running';
      run.lease = { token, started_at: Date.now(), expires_at: Date.now() + 90000 };
    });
    if (!work) return claimed;
    let result, error;
    try {
      result = work.kind === 'query'
        ? await this.search(work.record.query, { key: this.key(), country: claimed.app.country, language: claimed.app.language })
        : await this.fetch(work.record.url);
    } catch (e) { error = String(e.message || 'Source request failed').slice(0, 400); }
    return this.store.mutateRun(args.run_id, run => {
      if (run.lease?.token !== token) throw new Error('Collection lease expired; result discarded');
      if (work.kind === 'query') {
        const q = run.queries.find(q => q.id === work.record.id);
        q.status = error ? 'failed' : 'done'; q.error = error || ''; q.finished_at = now();
        if (!error) for (const hit of result) {
          let url; try { url = canonicalUrl(hit.url); } catch { continue; }
          const sourceId = hash(`${run.id}:${url}`);
          const existing = this.store.list('sources', { run_id: run.id }).find(s => s.id === sourceId);
          if (existing) { existing.query_ids = [...new Set([...existing.query_ids, q.id])]; this.store.put('sources', existing); continue; }
          this.store.put('sources', { id: sourceId, app_id: run.app_id, run_id: run.id, url, title: hit.title || url, snippet: hit.snippet || '',
            content: '', family: 'unknown', context_id: url, published_at: null, query_ids: [q.id], status: 'pending', attempts: 0,
            provenance: 'live_web', created_at: now(), retrieved_at: null, analysis_status: 'pending' });
        }
      } else {
        const s = this.store.child('sources', work.record.id, run.id);
        s.status = error ? 'failed' : 'fetched'; s.error = error || ''; s.retrieved_at = now();
        if (!error) { s.content = normalize(result.content); s.content_hash = hash(s.content); s.truncated = Boolean(result.truncated); s.final_url = result.final_url || s.url; }
        this.store.put('sources', s);
      }
      run.active_ms += Math.max(0, Date.now() - run.lease.started_at); run.lease = null;
      if (run.status === 'running') run.status = 'queued'; // A pause/cancel during I/O survives.
      this.invalidate(run.id);
    });
  }
  importSource(args) {
    const run = this.store.get('runs', args.run_id);
    this.editable(run);
    const url = canonicalUrl(args.url);
    const content = normalize(text(args.content, 'Source excerpt', 100000));
    const sourceId = hash(`${run.id}:${url}`);
    const existing = this.store.list('sources', { run_id: run.id }).find(s => s.id === sourceId);
    if (existing?.content && existing.content !== content) throw new Error('This URL already has a different snapshot. Create a new run to replace source content');
    const published = args.published_at || null;
    if (published && (!/^\d{4}-\d{2}-\d{2}$/.test(published) || !Number.isFinite(Date.parse(published)) || new Date(published).toISOString().slice(0, 10) !== published || Date.parse(published) > Date.now())) throw new Error('Publication date must be a past ISO date');
    this.invalidate(run.id);
    return this.store.put('sources', {
      ...existing, id: sourceId, app_id: run.app_id, run_id: run.id, url,
      title: text(args.title || existing?.title || url, 'Source title', 500), content, content_hash: hash(content),
      family: choice(args.family || 'unknown', ['community', 'app_review', 'video_comment', 'other', 'unknown'], 'source family'),
      context_id: text(args.context_id || url, 'Thread or review context', 4000), published_at: published,
      provenance: existing?.provenance === 'live_web' ? 'live_web' : 'imported',
      provenance_note: text(args.provenance_note, 'Provenance note', 2000),
      status: existing?.status === 'fetched' ? 'fetched' : 'imported_unverified',
      attempts: existing?.attempts || 0, query_ids: existing?.query_ids || [], snippet: '',
      created_at: existing?.created_at || now(), retrieved_at: existing?.retrieved_at || now(), analysis_status: existing?.analysis_status || 'pending'
    });
  }
  importSources(args) {
    const records = parseSources(args.format, args.data);
    return this.store.transaction(() => ({ sources: records.map(record => this.importSource({ ...record, run_id: args.run_id })) }));
  }
  annotateSource(args) {
    const source = this.store.child('sources', args.source_id, args.run_id);
    if (!source.content || source.status === 'deleted') throw new Error('No readable source to annotate');
    return this.importSource({ ...source, ...args, content: source.content, url: source.url });
  }
  recordEvidence(args) {
    const run = this.store.get('runs', args.run_id); this.editable(run);
    const source = this.store.child('sources', args.source_id, run.id);
    if (!source.content || source.status === 'deleted') throw new Error('Source has no usable context');
    const fields = evidenceFields(args, run.app);
    const quote = normalize(fields.quote), index = normalize(source.content).indexOf(quote);
    if (index === -1) throw new Error('Quote does not match the stored source text');
    const duplicate_group = hash(quote.toLowerCase());
    const key = hash(`${run.id}:${source.id}:${quote}`);
    const existing = this.store.list('evidence', { run_id: run.id }).find(e => e.id === key);
    if (existing) return existing; // Never overwrite a reviewed record on retry.
    this.invalidate(run.id);
    return this.store.put('evidence', {
      ...fields, id: key, app_id: run.app_id, run_id: run.id, source_id: source.id, duplicate_group,
      context: source.content.slice(Math.max(0, index - 300), index + quote.length + 300),
      locator: { normalized_start: index, normalized_end: index + quote.length },
      verification: source.status === 'fetched' ? 'source_matched' : 'imported_unverified',
      review_status: 'pending', created_at: now(), updated_at: now()
    });
  }
  review(args) {
    const run = this.store.get('runs', args.run_id); this.editable(run);
    return this.store.transaction(() => {
      const e = this.store.child('evidence', args.evidence_id, run.id);
      const s = this.store.child('sources', e.source_id, run.id);
      if (s.status === 'deleted') throw new Error('Source has been deleted');
      const decision = choice(args.decision, ['accepted', 'rejected', 'pending'], 'review decision');
      const reason = text(args.reason, 'Review reason', 3000);
      if (args.corrections) {
        const corrected = evidenceFields({ ...e, ...args.corrections, quote: e.quote }, run.app);
        Object.assign(e, corrected);
      }
      if (decision === 'accepted' && e.verification === 'imported_unverified') {
        if (!args.source_checked) throw new Error('Imported excerpts require a human source check before acceptance');
        e.verification = 'human_checked';
      }
      const review = { id: id(), app_id: run.app_id, run_id: run.id, evidence_id: e.id, decision, reason,
        reviewer: text(args.reviewer || 'Operator', 'Reviewer', 120), corrections: args.corrections || {}, source_checked: Boolean(args.source_checked), created_at: now() };
      e.review_status = decision; e.updated_at = now();
      this.store.put('reviews', review); this.store.put('evidence', e);
      run.outcome = null; this.store.put('runs', run); this.invalidate(run.id);
      return e;
    });
  }
  analysisDone(args) {
    const run = this.store.get('runs', args.run_id); this.editable(run);
    const source = this.store.child('sources', args.source_id, run.id);
    if (!source.content?.trim() || source.status === 'deleted') {
      throw new Error(`Source has no analyzable content (status: ${source.status || 'unknown'}); skip it`);
    }
    source.analysis_status = 'reviewed_by_agent';
    source.analysis_note = text(args.note, 'Analysis note', 3000);
    source.analyzed_at = now();
    this.invalidate(run.id);
    return this.store.put('sources', source);
  }
  removeSource(args) {
    const run = this.store.get('runs', args.run_id);
    if (run.lease?.expires_at > Date.now()) throw new Error('Wait for the active collection step before deleting a source');
    return this.store.transaction(() => {
      const source = this.store.child('sources', args.source_id, run.id);
      source.content = ''; source.snippet = ''; source.provenance_note = ''; source.analysis_note = ''; source.status = 'deleted'; source.deletion_reason = text(args.reason, 'Deletion reason', 2000);
      this.store.put('sources', source);
      for (const e of this.store.list('evidence', { run_id: run.id }).filter(e => e.source_id === source.id)) {
        e.quote = ''; e.context = ''; e.rationale = 'Source removed'; e.consequence = ''; e.workaround = ''; e.spending_signal = ''; e.verification = 'invalidated'; e.review_status = 'invalidated'; this.store.put('evidence', e);
        for (const review of this.store.list('reviews', { run_id: run.id }).filter(r => r.evidence_id === e.id)) {
          review.reason = 'Source removed; review text purged'; review.corrections = {}; this.store.put('reviews', review);
        }
      }
      // Exports may embed deleted quotations; remove their contents, not just a flag.
      for (const a of this.store.list('artifacts', { run_id: run.id })) { a.files = {}; a.stale = true; a.deleted_source = true; this.store.put('artifacts', a); }
      run.outcome = null; run.status = 'awaiting_review'; this.store.put('runs', run);
      return { deleted: source.id };
    });
  }
  invalidate(runId) {
    const run = this.store.get('runs', runId);
    for (const a of this.store.list('artifacts', { app_id: run.app_id })) {
      if (a.run_id === runId || a.scope === 'app') { a.stale = true; this.store.put('artifacts', a); }
    }
  }
  outcome(args) {
    return this.store.mutateRun(args.run_id, run => {
      if (run.status === 'completed') throw new Error('This run already has a recorded outcome');
      if (run.lease?.expires_at > Date.now()) throw new Error('Wait for the active collection step');
      const value = choice(args.outcome, ['insufficient_evidence', 'needs_targeted_research', 'ready_for_interviews', 'reposition_candidate'], 'Day 1 outcome');
      const summary = summarize(this.store, run);
      if (value === 'ready_for_interviews' && !summary.ready) throw new Error('Interview-readiness criteria have not passed. Record a research outcome and explain any decision to interview anyway');
      run.outcome = { value, reason: text(args.reason, 'Outcome rationale', 4000), recorded_at: now(), reviewer: 'Operator' };
      run.status = 'completed'; this.invalidate(run.id);
    });
  }
  export(args) {
    return this.store.transaction(() => {
      if (args.app_id) {
        const app = this.store.get('apps', args.app_id);
        const runs = this.store.list('runs', { app_id: app.id });
        if (runs.some(r => r.lease?.expires_at > Date.now())) throw new Error('Wait for active collection before exporting consolidated results');
        const summary = summarizeApp(this.store, app, runs);
        const previous = this.store.list('artifacts', { app_id: app.id }).filter(a => a.scope === 'app');
        const artifact = { id: id(), app_id: app.id, run_id: '', scope: 'app', version: previous.length + 1, created_at: now(), stale: false, files: buildAppReports(this.store, app, runs, summary) };
        this.store.put('artifacts', artifact); return artifact;
      }
      const run = this.store.get('runs', args.run_id);
      if (run.lease?.expires_at > Date.now()) throw new Error('Wait for the active collection step before exporting');
      run.artifact_version++; this.store.put('runs', run);
      const artifact = { id: id(), app_id: run.app_id, run_id: run.id, version: run.artifact_version, created_at: now(), stale: false, files: buildReports(this.store, run) };
      this.store.put('artifacts', artifact); return artifact;
    });
  }
  artifact(args) {
    if (args.app_id) {
      const artifact = this.store.get('artifacts', args.artifact_id);
      if (artifact.app_id !== args.app_id || artifact.scope !== 'app') throw new Error('Artifact does not belong to this app');
      if (artifact.stale) throw new Error('This consolidated export is stale; regenerate it from current evidence');
      return artifact;
    }
    const a = this.store.child('artifacts', args.artifact_id, args.run_id);
    if (a.stale) throw new Error('This export is stale; regenerate it from current evidence');
    return a;
  }
  editable(run) {
    if (['completed', 'cancelled'].includes(run.status)) throw new Error('Create a new run to change a completed or cancelled study');
    if (run.lease?.expires_at > Date.now()) throw new Error('Wait for the active collection step before editing evidence');
  }
}
