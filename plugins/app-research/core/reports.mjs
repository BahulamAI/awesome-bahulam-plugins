const unique = (rows, key) => new Set(rows.map(e => e[key])).size;
const md = value => String(value || '').replace(/[<>]/g, '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_\[\]|])/g, '\\$1');
const link = url => `<${String(url).replace(/[<>\s]/g, encodeURIComponent)}>`;

function summarizeRecords(run, sources, evidence, referenceDate = run.created_at) {
  const byId = new Map(sources.map(s => [s.id, s]));
  const accepted = evidence.filter(e => e.review_status === 'accepted' && ['source_matched', 'human_checked'].includes(e.verification) && byId.get(e.source_id)?.status !== 'deleted');
  const cutoff = new Date(referenceDate); cutoff.setUTCMonth(cutoff.getUTCMonth() - run.app.criteria.months);
  const recent = e => { const d = byId.get(e.source_id)?.published_at; return d && Date.parse(d) >= cutoff.getTime() && Date.parse(d) <= Date.parse(referenceDate); };
  const complaints = accepted.filter(e => e.unprompted === 'yes' && e.direction === 'supports' && e.relevance !== 'irrelevant');
  const audiences = run.app.audiences.map(audience => {
    const rows = complaints.filter(e => e.audience === audience && e.relevance === 'direct' && recent(e));
    const contexts = new Set(rows.map(e => byId.get(e.source_id)?.context_id));
    const families = new Set(rows.map(e => byId.get(e.source_id)?.family).filter(f => f && f !== 'unknown'));
    const consequences = unique(rows.filter(e => e.consequence || e.workaround), 'duplicate_group');
    return { audience, direct_groups: unique(rows, 'duplicate_group'), contexts: contexts.size, families: families.size, consequences,
      passed: unique(rows, 'duplicate_group') >= run.app.criteria.direct && contexts.size >= run.app.criteria.contexts && families.size >= run.app.criteria.families && consequences >= run.app.criteria.consequences };
  });
  const queries_done = run.queries.filter(q => q.status === 'done').length;
  const fetched = sources.filter(s => s.status === 'fetched');
  const coverage_complete = queries_done === run.queries.length && sources.length > 0 && sources.every(s => ['fetched', 'imported_unverified'].includes(s.status));
  const analysis_complete = sources.filter(s => s.content).every(s => s.analysis_status === 'reviewed_by_agent');
  const review_complete = evidence.every(e => e.review_status !== 'pending');
  return { queries_planned: run.queries.length, queries_done, sources: sources.length, fetched: fetched.length,
    failed_sources: sources.filter(s => s.status === 'failed').length, candidates: evidence.length, accepted: accepted.length,
    pending: evidence.filter(e => e.review_status === 'pending').length, complaint_groups: unique(complaints, 'duplicate_group'),
    direct_groups: unique(complaints.filter(e => e.relevance === 'direct'), 'duplicate_group'),
    contradictions: accepted.filter(e => e.direction === 'contradicts').length,
    families: [...new Set(sources.filter(s => s.content).map(s => s.family).filter(f => f !== 'unknown'))],
    audiences, coverage_complete, analysis_complete, review_complete,
    ready: coverage_complete && analysis_complete && review_complete && audiences.some(a => a.passed) };
}

export function summarize(store, run) {
  return summarizeRecords(run, store.list('sources', { run_id: run.id }), store.list('evidence', { run_id: run.id }));
}

export function summarizeApp(store, app, runs) {
  const sources = store.list('sources', { app_id: app.id });
  const evidence = store.list('evidence', { app_id: app.id });
  const referenceDate = runs.map(r => r.created_at).sort().at(-1) || app.updated_at;
  const queryRows = runs.flatMap(r => r.queries);
  const combined = {
    id: app.id, app, created_at: referenceDate,
    queries: queryRows,
  };
  const base = summarizeRecords(combined, sources, evidence, referenceDate);
  const perRun = runs.map(run => ({ id: run.id, status: run.status, summary: summarize(store, run) }));
  const coverage_complete = perRun.length > 0 && perRun.every(r => r.summary.coverage_complete);
  const analysis_complete = perRun.length > 0 && perRun.every(r => r.summary.analysis_complete);
  const review_complete = perRun.length > 0 && perRun.every(r => r.summary.review_complete);
  return {
    ...base,
    queries_planned: queryRows.length,
    queries_done: queryRows.filter(q => q.status === 'done').length,
    sources: sources.length,
    fetched: sources.filter(s => s.status === 'fetched').length,
    failed_sources: sources.filter(s => s.status === 'failed').length,
    candidates: evidence.length,
    coverage_complete, analysis_complete, review_complete,
    ready: coverage_complete && analysis_complete && review_complete && base.audiences.some(a => a.passed),
    run_count: runs.length,
    runs: perRun
  };
}

export function buildReports(store, run) {
  const s = summarize(store, run), sources = store.list('sources', { run_id: run.id });
  const reportRun = structuredClone(run);
  delete reportRun.search_reserved_usd;
  reportRun.budgets = { queries: run.budgets.queries, documents: run.budgets.documents, minutes: run.budgets.minutes };
  const byId = new Map(sources.map(x => [x.id, x]));
  const all = store.list('evidence', { run_id: run.id });
  const accepted = all.filter(e => e.review_status === 'accepted' && ['source_matched', 'human_checked'].includes(e.verification));
  const entry = e => {
    const source = byId.get(e.source_id);
    return `### ${e.id.slice(0, 12)} · ${md(e.audience)}\n\n> ${md(e.quote)}\n\nSource: ${link(source.url)}\n\n${md(e.relevance)} · ${md(e.direction)} · ${md(e.verification)}\n\nInterpretation: ${md(e.rationale)}\n\nConsequence: ${md(e.consequence || 'Not stated')}\n\nWorkaround: ${md(e.workaround || 'Not stated')}\n\nSpending signal: ${md(e.spending_signal || 'Not stated')}\n`;
  };
  const header = `# ${md(run.app.name)} — Day 1 demand evidence\n\nRun: ${run.id} · Export ${run.artifact_version}\n\n${md(run.app.brief)}\n\n**Five real conversations are pending. This report does not establish willingness to pay or a build decision.**\n`;
  const stats = `\n## Coverage\n\n- Search calls: ${run.search_attempts || 0}/${run.budgets.queries} cap (attempts, including failed calls and retries)\n- Planned queries completed: ${s.queries_done}/${s.queries_planned}\n- Sources discovered: ${s.sources}; fetched: ${s.fetched}; failed: ${s.failed_sources}\n- Candidates: ${s.candidates}; reviewed accepted: ${s.accepted}; pending: ${s.pending}\n- Distinct unprompted complaint groups: ${s.complaint_groups}; direct: ${s.direct_groups}\n- Accepted contradictions: ${s.contradictions}\n- Source families: ${s.families.join(', ') || 'Not established'}\n- Coverage complete: ${s.coverage_complete}; source analysis complete: ${s.analysis_complete}\n- Interview-readiness criteria passed: ${s.ready}\n- Billed search usage: See Brave dashboard; not estimated here\n- Bahulam agent-session usage: not metered by this plugin\n- Stop reason: ${run.stop_reason || 'Run in progress'}\n`;
  const findings = `\n## Reviewed evidence\n\n${accepted.length ? accepted.map(entry).join('\n') : 'No accepted evidence yet. Do not interpret this as no demand.'}\n`;
  const contrary = `\n## Counterevidence\n\n${accepted.filter(e => e.direction === 'contradicts').map(entry).join('\n') || 'No accepted counterevidence yet; absence does not prove the hypothesis.'}\n`;
  const outcome = `\n## Next action\n\n${run.outcome ? `${run.outcome.value}: ${md(run.outcome.reason)}` : 'Operator decision pending.'}\n\n## Limitations\n\nSearch results are a convenience sample, not a population estimate. Duplicate quotes are grouped; different wording and authors may still be correlated. Dates and source families require review. Imported text requires a documented source check. Raw source content is not included in this report.\n`;
  return {
    'demand-evidence.md': header + stats + findings + contrary + outcome,
    'evidence.jsonl': all.map(e => JSON.stringify({ ...e, source_url: byId.get(e.source_id)?.url, reviews: store.list('reviews', { run_id: run.id }).filter(r => r.evidence_id === e.id) })).join('\n') + '\n',
    'language-bank.md': `# ${md(run.app.name)} — verbatim language bank\n\n${accepted.map(e => `- “${md(e.quote)}” — ${link(byId.get(e.source_id).url)} · Evidence ${e.id}`).join('\n') || 'No reviewed phrases yet.'}\n`,
    'interview-brief.md': `# Day 2 interview handoff\n\nApp: ${md(run.app.name)}\n\nFive actual conversations are pending.\n\n## Audiences to prioritize\n\n${s.audiences.map(a => `- ${md(a.audience)}: ${a.direct_groups} recent direct complaint groups; ${a.contexts} contexts; ${a.families} families.`).join('\n')}\n\n## Ask about actual events\n\n- What happened the last time this problem occurred?\n- What was the consequence, and how often does it happen?\n- What did you do instead? What already works?\n- What have you spent money or effort on?\n- What would make adopting another tool inconvenient?\n\nPreserve original conversation notes separately from generated reports.\n`,
    'run-summary.json': JSON.stringify({ run: reportRun, summary: s, sources: sources.map(({ content, snippet, ...source }) => source), generated_at: new Date().toISOString() }, null, 2)
  };
}

export function buildAppReports(store, app, runs, summary) {
  const sources = store.list('sources', { app_id: app.id });
  const byId = new Map(sources.map(s => [s.id, s]));
  const evidence = store.list('evidence', { app_id: app.id });
  const accepted = evidence.filter(e => e.review_status === 'accepted' && ['source_matched', 'human_checked'].includes(e.verification) && byId.get(e.source_id)?.status !== 'deleted');
  const entry = e => {
    const source = byId.get(e.source_id);
    const run = runs.find(r => r.id === e.run_id);
    return `### ${e.id.slice(0, 12)} · ${md(e.audience)} · Run ${run?.id.slice(0, 8) || 'unknown'}\n\n> ${md(e.quote)}\n\nSource: ${source ? link(source.url) : 'Source unavailable'}\n\n${md(e.relevance)} · ${md(e.direction)} · ${md(e.verification)}\n\nInterpretation: ${md(e.rationale)}\n\nConsequence: ${md(e.consequence || 'Not stated')}\n\nWorkaround: ${md(e.workaround || 'Not stated')}\n\nSpending signal: ${md(e.spending_signal || 'Not stated')}\n`;
  };
  const header = `# ${md(app.name)} — consolidated Day 1 demand research\n\nApp idea: ${app.id} · Runs included: ${runs.length}\n\n${md(app.brief)}\n\n**Five real conversations are pending. This report does not establish willingness to pay or a build decision.**\n`;
  const stats = `\n## Consolidated coverage\n\n- Runs: ${runs.length}\n- Search calls: ${runs.reduce((n, r) => n + (r.search_attempts || 0), 0)} total attempts (per-run caps apply; billed usage is in your Brave dashboard)\n- Planned queries completed: ${summary.queries_done}/${summary.queries_planned}\n- Sources discovered: ${summary.sources}; fetched: ${summary.fetched}; failed: ${summary.failed_sources}\n- Candidates: ${summary.candidates}; accepted: ${summary.accepted}; pending: ${summary.pending}\n- Distinct unprompted complaint groups: ${summary.complaint_groups}; direct: ${summary.direct_groups}\n- Accepted contradictions: ${summary.contradictions}\n- Source families: ${summary.families.join(', ') || 'Not established'}\n- Collection coverage complete across every run: ${summary.coverage_complete}\n- Source analysis complete across every run: ${summary.analysis_complete}\n- Evidence review complete across every run: ${summary.review_complete}\n- Interview-readiness criteria passed: ${summary.ready}\n`;
  const runStatus = runs.map(r => `- ${r.id}: ${r.status}; ${r.search_attempts || 0} search calls; ${summarize(store, r).accepted} accepted evidence`).join('\n');
  const findings = `\n## Accepted evidence across all runs\n\n${accepted.length ? accepted.map(entry).join('\n') : 'No accepted evidence yet. Do not interpret this as no demand.'}\n`;
  const contrary = `\n## Counterevidence\n\n${accepted.filter(e => e.direction === 'contradicts').map(entry).join('\n') || 'No accepted counterevidence yet; absence does not prove the hypothesis.'}\n`;
  return {
    'demand-evidence.md': header + stats + `\n## Run history\n\n${runStatus || 'No runs yet.'}\n` + findings + contrary + `\n## Limitations\n\nSearch results are a convenience sample, not a population estimate. Duplicate quotes are grouped; different wording and authors may still be correlated. Dates and source families require review. Imported text requires a documented source check. Raw source content is not included.\n`,
    'evidence.jsonl': evidence.map(e => JSON.stringify({ ...e, source_url: byId.get(e.source_id)?.url, reviews: store.list('reviews', { run_id: e.run_id }).filter(r => r.evidence_id === e.id) })).join('\n') + (evidence.length ? '\n' : ''),
    'language-bank.md': `# ${md(app.name)} — consolidated verbatim language bank\n\n${accepted.map(e => `- “${md(e.quote)}” — ${link(byId.get(e.source_id)?.url || '')} · Run ${e.run_id} · Evidence ${e.id}`).join('\n') || 'No reviewed phrases yet.'}\n`,
    'run-summary.json': JSON.stringify({ app, summary, runs: runs.map(r => ({ id: r.id, status: r.status, created_at: r.created_at, search_attempts: r.search_attempts, stop_reason: r.stop_reason })), generated_at: new Date().toISOString() }, null, 2)
  };
}
