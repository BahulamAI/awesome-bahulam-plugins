const panel = document.body.dataset.panel;
const token = new URLSearchParams(location.search).get('token') || '';
const views = [['start', 'Start here'], ['ideas', 'App ideas'], ['runs', 'Research runs'], ['evidence', 'Evidence review'], ['results', 'Results']];
const titles = { start: ['Start here. Validate before you build.', 'A repeatable Day 1 workflow for one app idea at a time.'], ideas: ['Every idea starts with a question.', 'Define the problem. Collect the evidence. Decide what deserves a conversation.'], runs: ['Follow the research.', 'Freeze your plan, collect sources, and pick up where you left off.'], evidence: ['Keep the words. Check the meaning.', 'Review exact quotes against their source before they become evidence.'], results: ['A clear next step.', 'Traceable findings, honest gaps, and a handoff to real conversations.'] };
const promptText = {
  plan: 'Draft a Day 1 query plan for the selected app idea and its saved audiences. Cover first-person problem reports, current workarounds and alternatives, and contrary evidence for every audience. Show every exact query and ask me to approve the plan before creating a run. Search-call cap: [N]. Document-attempt cap: [N]. Active collection limit: [N] minutes. Do not collect sources.',
  create: 'Create a research run for the selected app idea using the exact query plan and caps I approved above. Check for an existing duplicate first. Create the run only; do not start collection.',
  analyze: 'Analyze the stored source snapshots for the selected run. Fetch source content before evaluating it; skip empty, failed, and metadata-only sources as access gaps. Delegate to the demand analyst and demand skeptic. Record only exact source-matched evidence, preserve contradictions and unknowns, and do not accept/reject evidence or record an outcome.',
  results: 'Summarize the consolidated results across all runs for the selected app idea. Separate direct, unprompted first-person evidence from adjacent, prompted, and vendor content. Include counterevidence, source quality, collection/analysis/review gaps, and distinct complaint groups. Do not treat market-size estimates or accepted-record counts as proof of willingness to pay. Recommend the next interviews or validation experiment.'
};
let selection = readSelection(), data, collecting = false, busy = false, dirty = false, currentSource = null;
let evidenceFilter = 'all', audienceFilter = 'all', cachedArtifact = null;
function readSelection() { try { return JSON.parse(localStorage.getItem('app-research.selection') || '{}'); } catch { return {}; } }
function saveSelection() { try { localStorage.setItem('app-research.selection', JSON.stringify(selection)); } catch {} }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function human(s) { return String(s || '').replaceAll('_', ' '); }
function date(s) { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function badge(s) { return `<span class="badge ${/failed|rejected|cancelled|invalidated/.test(s) ? 'bad' : /pending|paused|unknown|unverified/.test(s) ? 'warn' : /queued/.test(s) ? 'neutral' : ''}">${esc(human(s))}</span>`; }
function options(list, selected = '') { return list.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(human(v))}</option>`).join(''); }
function metric(title, value, note) { return `<div class="metric"><span>${title}</span><strong class="number">${esc(value)}</strong><small>${esc(note)}</small></div>`; }
function status(message, error = false) { const e = document.querySelector('#status'); e.textContent = message; e.classList.toggle('error', error); }
async function api(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bahulam-Local-Token': token }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.message || result.error || 'Request failed');
  return result;
}
async function tool(name, args = {}) {
  const r = (await api('/api/tools/execute', { name: `research_${name}`, args })).result;
  if (r?.success === false) throw new Error(typeof r.output === 'string' ? r.output : 'Research operation failed');
  return r?.output ?? r;
}
document.body.innerHTML = `<div class="shell"><aside><div class="brand"><span class="brand-icon">↗</span>Fieldnotes</div><div class="side-caption">App research / Day 01</div><nav>${views.map(([key, label], i) => `<a href="${key}.html?token=${encodeURIComponent(token)}" class="${key === panel ? 'active' : ''}"><span class="nav-index">0${i + 1}</span>${label}</a>`).join('')}</nav><div class="side-foot">Evidence before investment.<br>Built for your next 100 ideas.</div></aside><main><header class="topbar"><span class="eyebrow">Day 1 · Demand & language</span><div class="selectors"><select id="app-select" aria-label="Selected app"></select><select id="run-select" aria-label="Selected research run"></select><button id="header-new-app" class="create-idea">＋ Create idea</button><button id="refresh" title="Refresh research" aria-label="Refresh research">↻</button></div></header><div class="page-heading"><div><h1>${titles[panel][0]}</h1><p class="subtle">${titles[panel][1]}</p></div><span class="badge neutral">Research workspace</span></div><div id="content"><div class="loading">Loading your research…</div></div><div id="status" role="status" aria-live="polite"></div></main></div>`;
document.querySelector('#status').className = 'status-line';
document.querySelector('#content').addEventListener('input', () => { dirty = true; });
document.querySelector('#content').addEventListener('change', event => { if (event.target.closest('form')) dirty = true; });
document.querySelector('#refresh').onclick = () => refresh().catch(e => status(e.message, true));
document.querySelector('#header-new-app').onclick = () => {
  if (panel !== 'ideas') {
    location.href = `ideas.html?token=${encodeURIComponent(token)}&new=1`;
    return;
  }
  beginNewIdea();
};
document.querySelector('#app-select').onchange = e => { selection = { app_id: e.target.value }; currentSource = null; saveSelection(); refresh().catch(e => status(e.message, true)); };
document.querySelector('#run-select').onchange = e => { selection.run_id = e.target.value; currentSource = null; cachedArtifact = null; saveSelection(); refresh().catch(e => status(e.message, true)); };

async function refresh() {
  let initial;
  try { initial = await tool('dashboard', selection); }
  catch (e) {
    if (!/Run does not belong/.test(e.message)) throw e;
    selection = {}; initial = await tool('dashboard');
  }
  data = initial;
  if (!data.apps.some(a => a.id === selection.app_id)) selection = { app_id: data.apps[0]?.id };
  const runs = data.runs.filter(r => r.app_id === selection.app_id);
  if (!runs.some(r => r.id === selection.run_id)) selection.run_id = runs.at(-1)?.id;
  if (selection.run_id !== data.selected?.id || (selection.app_id && initial.runs.some(r => r.app_id !== selection.app_id))) data = await tool('dashboard', selection);
  saveSelection();
  document.querySelector('#app-select').innerHTML = data.apps.length ? data.apps.map(a => `<option value="${a.id}" ${a.id === selection.app_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('') : '<option>No app selected</option>';
  document.querySelector('#run-select').innerHTML = data.runs.length ? data.runs.map((r, i) => `<option value="${r.id}" ${r.id === selection.run_id ? 'selected' : ''}>Run ${i + 1} · ${esc(human(r.status))}</option>`).join('') : '<option>No runs yet</option>';
  render();
}
function activeApp() { return data.apps.find(a => a.id === selection.app_id); }
function empty(title, detail, action = '') { return `<section class="card empty"><div class="symbol">◎</div><h2>${title}</h2><p>${detail}</p>${action}</section>`; }
function navLink(view, label) { return `<a href="${view}.html?token=${encodeURIComponent(token)}">${label} →</a>`; }
async function copyPrompt(key) {
  const value = promptText[key];
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement('textarea');
    field.value = value; field.style.position = 'fixed'; field.style.opacity = '0';
    document.body.append(field); field.select();
    const copied = document.execCommand('copy'); field.remove();
    if (!copied) throw new Error('Could not copy the prompt. Select and copy it from the prompt preview.');
  }
  status('Prompt copied. Paste it into workspace chat and fill in the [N] limits where shown.');
}
function startView() {
  const app = activeApp(), run = data.selected;
  const active = app ? `<div class="notice good"><strong>Selected idea: ${esc(app.name)}</strong><br>${run ? `Selected run: ${esc(human(run.status))}.` : 'No research run selected yet.'} Use the dropdowns above to switch ideas or runs.</div>` : `<div class="notice"><strong>No app idea selected yet.</strong><br>Create one to begin. Keep different target audiences in separate ideas so their results stay comparable.</div>`;
  const step = (number, title, copy, link, label) => `<article class="start-step"><span class="step-number">${number}</span><div><h3>${title}</h3><p>${copy}</p>${navLink(link, label)}</div></article>`;
  const prompt = (key, title, copy) => `<article class="prompt-card"><div><h3>${title}</h3><p class="help">${copy}</p></div><details><summary>Preview prompt</summary><pre class="prompt-preview">${esc(promptText[key])}</pre></details><button data-copy="${key}">Copy prompt</button></article>`;
  return `${active}<div class="start-layout"><section class="card"><div class="card-top"><div><h2>Your research path</h2><p class="help">Follow these steps in order. The evidence review stays human-controlled.</p></div>${app ? badge('idea selected') : ''}</div><div class="start-steps">${step('01', 'Define one app idea', 'Name the audience, situation, and problem you want to test. Keep different customer groups separate so their results do not get blended.', 'ideas', 'Create or edit an idea')}${step('02', 'Plan a research run', 'Review the exact searches and set call, document, and time caps. Each run freezes the idea brief and query plan.', 'runs', 'Plan a research run')}${step('03', 'Collect and analyze sources', 'Use the configured search connection, then ask the agent to analyze readable source content. Failed or blocked pages remain access gaps.', 'runs', 'Open research runs')}${step('04', 'Review evidence', 'Check each quote against its source. Accept or reject candidates with a reason; agents never make those decisions for you.', 'evidence', 'Review evidence')}${step('05', 'Read the combined findings', 'Results combine accepted evidence across runs for the selected idea. Check gaps and contradictions, then use the interview brief to talk to real people.', 'results', 'See consolidated results')}</div><p class="help">Day 1 desk research identifies questions to investigate. It does not prove demand, market size, retention, or willingness to pay.</p></section><section class="card"><h2>Copy-ready agent prompts</h2><p class="help">Paste these into workspace chat. Replace bracketed limits with your chosen caps; run creation and collection remain separate steps.</p><div class="prompt-list">${prompt('plan', '1 · Draft the query plan', 'Use before creating a run. The agent should show exact searches and wait for your approval.')}${prompt('create', '2 · Create the approved run', 'Use after you approve the query plan and caps. Creating a run does not start collection.')}${prompt('analyze', '3 · Analyze collected sources', 'Use after collection. The agent records candidates for your review and preserves source-access gaps.')}${prompt('results', '4 · Interpret all runs', 'Use for a skeptical synthesis and concrete next validation steps.')}</div></section></div>`;
}
function render() {
  dirty = false;
  document.querySelector('#app-select').disabled = collecting;
  document.querySelector('#run-select').disabled = collecting;
  const root = document.querySelector('#content');
  root.innerHTML = ({ start: startView, ideas: ideasView, runs: runsView, evidence: evidenceView, results: resultsView })[panel]();
  root.querySelectorAll('form').forEach(f => f.addEventListener('submit', onSubmit));
  root.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyPrompt(b.dataset.copy).catch(e => status(e.message, true))));
  root.querySelector('#evidence-filter')?.addEventListener('change', e => { evidenceFilter = e.target.value; render(); });
  root.querySelector('#audience-filter')?.addEventListener('change', e => { audienceFilter = e.target.value; render(); });
  root.querySelector('#candidate-source')?.addEventListener('change', e => loadSource(e.target.value).catch(e => status(e.message, true)));
}
function beginNewIdea() {
  const form = document.querySelector('#idea-form');
  if (!form) return;
  form.reset();
  form.elements.app_id.value = '';
  dirty = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.name.focus({ preventScroll: true });
  status('Enter the new idea brief. Saving it will select it in the app dropdown.');
}
function ideasView() {
  const app = activeApp(), runs = data.runs;
  return `<div class="metrics">${metric('App ideas', data.apps.length, 'One reusable research process')}${metric('Research runs', runs.length, app?.name || 'Select an idea')}${metric('Reviewed evidence', runs.reduce((n, r) => n + r.summary.accepted, 0), 'Accepted records across these runs')}${metric('Ready for interviews', runs.filter(r => r.summary.ready).length, 'Criteria passed, not proven demand')}</div><div class="grid wide"><section><div class="card-top"><h2>Your idea portfolio</h2><span class="muted-label">Select an idea to see its research</span></div><br>${data.apps.length ? data.apps.map(a => `<article class="card"><div class="card-top"><div><span class="eyebrow">Brief v${a.version}</span><h2 style="margin-top:9px">${esc(a.name)}</h2></div>${badge(a.id === selection.app_id ? 'selected' : 'idea')}</div><p class="subtle">${esc(a.brief)}</p><div class="row">${a.audiences.map(x => `<span class="badge neutral">${esc(x)}</span>`).join('')}</div><div class="card-footer"><span class="muted-label">Updated ${date(a.updated_at)}</span><div class="row"><button data-action="edit-app" data-id="${a.id}">Edit brief</button><button data-action="select-app" data-id="${a.id}">Open research</button></div></div></article>`).join('') : empty('Create your first app idea.', 'Start with one audience and a specific problem hypothesis. Save the brief to add it to your research workspace.')}${app ? `<div class="card"><h2>${esc(app.name)} · Recent runs</h2>${runs.length ? runs.slice().reverse().map(r => `<div class="run-item"><div class="row"><span>${date(r.created_at)}</span>${badge(r.status)}</div><p class="help">${r.summary.accepted} accepted · ${r.summary.pending} awaiting review · ${r.summary.queries_done}/${r.summary.queries_planned} searches</p><div class="row"><button data-action="select-run" data-id="${r.id}">Track this run</button><button data-action="delete-run" data-id="${r.id}" class="danger">Delete run</button></div></div>`).join('') : '<p class="help">No research runs yet.</p>'}${navLink('runs', 'Plan a research run')}</div>` : ''}</section><section><div class="card"><div class="card-top"><h2>App brief</h2><button data-action="new-app">New idea</button></div><p class="help">Define a problem to investigate. Keep the audience and hypotheses specific.</p><form id="idea-form" class="stack"><input name="app_id" type="hidden"><label>App name<input name="name" required maxlength="120" placeholder="Your next app"></label><label>Problem hypothesis<textarea name="brief" required placeholder="Who struggles, in what situation, and what happens?"></textarea></label><label>Audiences · one per line<textarea name="audiences" required placeholder="Parents coordinating school runs"></textarea></label><label>Hypotheses · one per line<textarea name="hypotheses" required placeholder="The current workaround causes meaningful delays."></textarea></label><div class="split"><label>Country<input name="country" value="US" maxlength="2" required></label><label>Language<input name="language" value="en" required></label></div><details><summary>Interview-readiness criteria</summary><div class="split">${[["direct","Direct groups",10],["contexts","Independent contexts",3],["families","Source families",2],["consequences","Consequences/workarounds",5],["months","Recency in months",24]].map(([key,label,value]) => `<label>${label}<input name="${key}" type="number" value="${value}" min="1" max="1000" required></label>`).join('')}</div><p class="help">Pilot heuristics, not market benchmarks. Each run freezes these values.</p></details><button class="primary">Save idea</button></form><hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><p class="help">Saving a new idea selects it in the app dropdown. Research results combine runs for the selected idea.</p></div></section></div>`;
}
function queryInputs(app) {
  const terms = { pain: ['coordination problem last time', 'delays confusion experience'], alternatives: ['shared checklist works well', 'group messages calendar solution'], contrary: ['another app too much effort', 'coordination not a problem'] };
  return app.audiences.map(a => `<fieldset><legend>${esc(a)}</legend><div class="stack">${Object.entries(terms).flatMap(([intent, suffixes]) => suffixes.map((suffix, i) => `<label>${human(intent)} · ${i + 1}<input data-query data-audience="${esc(a)}" data-intent="${intent}" value="${esc(`${a} ${suffix}`)}" required maxlength="500"></label>`)).join('')}</div></fieldset>`).join('');
}
function runsView() {
  const app = activeApp(), run = data.selected;
  if (!app) return empty('Start with an app idea.', 'A research run needs a brief and hypotheses.', navLink('ideas', 'Add an idea'));
  const plan = `<details class="card" ${run ? '' : 'open'}><summary>Plan a new run for ${esc(app.name)}</summary><form id="run-form" class="stack"><p class="help">Every audience needs pain, alternatives, and contrary searches. Edit these seed queries before freezing the plan.</p>${queryInputs(app)}<fieldset><legend>Collection limits</legend><div class="split"><label>Search-call cap<input name="queries" type="number" min="1" max="100" value="${Math.max(24, app.audiences.length * 6)}" required></label><label>Document attempts<input name="documents" type="number" min="1" max="500" value="60" required></label><label>Active collection minutes<input name="minutes" type="number" min="1" max="240" value="30" required></label></div><p class="help">Search calls include failed requests and retries. For billed usage, check your Brave dashboard.</p></fieldset><details><summary>Interview-readiness criteria</summary><p class="help">Frozen from this app brief: ${app.criteria.direct} recent direct complaint groups in one audience, ${app.criteria.contexts} independent contexts, ${app.criteria.families} source families, ${app.criteria.consequences} concrete consequences/workarounds. Last ${app.criteria.months} months. Full planned search coverage, source analysis, and evidence review required.</p></details><button class="primary">Freeze plan & create run</button></form></details>`;
  const settings = `<details class="card" ${!data.connectors.brave ? 'open' : ''}><summary>Search connection ${data.connectors.brave ? '· configured' : '· needs setup'}</summary><form id="settings-form" class="stack"><label>Brave Search API key<input name="key" type="password" autocomplete="off" placeholder="${data.connectors.brave ? 'Leave blank to keep saved key' : 'Enter your API key'}"></label><p class="help">Stored in your local Bahulam plugin settings. The key is never included in research reports. Source imports work without a key.</p><button>Save connection</button></form></details>`;
  if (!run) return plan + settings;
  const s = run.summary;
  const canEditLimits = ['queued', 'paused'].includes(run.status);
  const limitsEditor = `<details class="card"><summary>Edit collection limits</summary><form id="limits-form" class="stack"><p class="help">Changing these caps keeps this run’s query plan and evidence. Changes are logged. If paused, save the new limits and then resume collection.</p><div class="split"><label>Search-call cap<input name="queries" type="number" min="1" max="100" value="${run.budgets.queries}" required></label><label>Document attempts<input name="documents" type="number" min="1" max="500" value="${run.budgets.documents}" required></label><label>Active collection minutes<input name="minutes" type="number" min="1" max="240" value="${run.budgets.minutes}" required></label></div><button class="primary" ${canEditLimits ? '' : 'disabled'}>Save limits</button>${canEditLimits ? '' : '<p class="help">Limits can be edited only before collection finishes.</p>'}</form></details>`;
  return `<div class="metrics">${metric('Searches completed', `${s.queries_done}/${s.queries_planned}`, 'Frozen query plan')}${metric('Sources fetched', s.fetched, `${s.failed_sources} inaccessible`)}${metric('Evidence candidates', s.candidates, `${s.pending} awaiting review`)}${metric('Search calls', `${run.search_attempts || 0}/${run.budgets.queries}`, 'Attempts used / cap; see Brave for billing')}</div>${limitsEditor}${run.status === 'awaiting_review' ? `<div class="notice"><strong>Collection has stopped.</strong> Review the candidate evidence next. ${navLink('evidence', 'Continue to Evidence review')}</div>` : ''}<section class="card"><div class="card-top"><div><h2>${esc(app.name)} · ${date(run.created_at)}</h2><p class="help">${esc(human(run.stop_reason || 'Ready to collect sources'))}</p></div>${badge(run.status)}</div><div class="progress-track"><div class="progress-fill" style="width:${100 * s.queries_done / Math.max(1, s.queries_planned)}%"></div></div><div class="toolbar"><button class="primary" data-action="collect" ${collecting || ['completed', 'cancelled', 'awaiting_review'].includes(run.status) ? 'disabled' : ''}>${collecting ? 'Collecting…' : run.status === 'paused' ? 'Resume collection' : 'Start collection'}</button><button data-action="pause" ${run.status === 'completed' ? 'disabled' : ''}>Pause</button><button data-action="retry_failed" ${['completed', 'cancelled'].includes(run.status) ? 'disabled' : ''}>Retry failed steps</button><button data-action="cancel" class="danger" ${['completed', 'cancelled'].includes(run.status) ? 'disabled' : ''}>Cancel run</button></div><p class="help">Collection advances while this panel stays open. Completed steps persist; reopen and resume after an interruption.</p></section><div class="card"><h2>Query coverage</h2><div class="table-wrap"><table><thead><tr><th>Audience</th><th>Search</th><th>Intent</th><th>State</th></tr></thead><tbody>${run.queries.map(q => `<tr><td>${esc(q.audience)}</td><td class="query">${esc(q.query)}${q.error ? `<p class="help">${esc(q.error)}</p>` : ''}</td><td>${esc(q.intent)}</td><td>${badge(q.status)}</td></tr>`).join('')}</tbody></table></div></div>${sourcesView()}${settings}${plan}`;
}
function sourcesView() {
  return `<div class="card"><div class="card-top"><h2>Source trail</h2><span class="muted-label">${data.sources.length} discovered</span></div><div class="source-panel">${data.sources.map(s => `<div class="source-row"><div><a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><p class="help">${esc(s.family)} · ${s.published_at || 'Date unknown'} · ${s.content_chars} characters</p>${s.error ? `<p class="help">${esc(s.error)}</p>` : ''}</div>${badge(s.status)}</div>`).join('') || '<p class="help">Collected sources will appear here. Search snippets do not count as evidence.</p>'}</div></div>`;
}
function evidenceView() {
  const run = data.selected;
  if (!run) return empty('No research run selected.', 'Create a run to collect sources and review evidence.', navLink('runs', 'Plan research'));
  const s = run.summary;
  const visible = data.evidence.filter(e => (evidenceFilter === 'all' || e.review_status === evidenceFilter) && (audienceFilter === 'all' || e.audience === audienceFilter));
  const importForm = `<details class="card"><summary>Import a source or annotate its context</summary><form id="import-form" class="stack"><label>Source URL<input name="url" type="url" required></label><label>Title<input name="title" required></label><div class="split"><label>Source family<select name="family">${options(['unknown', 'community', 'app_review', 'video_comment', 'other'])}</select></label><label>Published date · leave blank if unknown<input name="published_at" type="date"></label></div><label>Thread/review context ID<input name="context_id" placeholder="Defaults to source URL; group comments from the same thread"></label><label>Original source text<textarea name="content" required rows="6"></textarea></label><label>Where did this text come from?<input name="provenance_note" placeholder="Export name, retrieval method, or source-check notes" required></label><button>Save source context</button></form></details>`;
  const candidate = `<details class="card"><summary>Add an evidence candidate</summary><form id="candidate-form" class="stack"><label>Source<select name="source_id" id="candidate-source" required><option value="">Choose a collected source</option>${data.sources.filter(s => s.content_chars).map(s => `<option value="${s.id}" ${currentSource?.id === s.id ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label><div id="source-context" class="context">${esc(currentSource?.content || 'Select a source to see its original context.')}</div><label>Exact quote<textarea name="quote" required></textarea></label><div class="split"><label>Audience<select name="audience">${options(run.app.audiences)}</select></label><label>Relevance<select name="relevance">${options(['direct', 'adjacent', 'irrelevant'])}</select></label><label>Direction<select name="direction">${options(['supports', 'contradicts', 'mixed/unclear'])}</select></label><label>Unprompted?<select name="unprompted">${options(['unknown', 'yes', 'no'])}</select></label></div><label>Hypotheses<div class="row">${run.app.hypotheses.map(h => `<label class="check"><input type="checkbox" name="hypothesis_ids" value="${esc(h.id)}">${esc(h.id)}: ${esc(h.statement)}</label>`).join('')}</div></label><label>Interpretation and relevance<textarea name="rationale" required></textarea></label><label>Concrete consequence<input name="consequence"></label><label>Current workaround<input name="workaround"></label><label>Explicit spending signal<input name="spending_signal" placeholder="Leave blank when not stated"></label><button>Save for review</button></form></details>`;
  return `<div class="metrics">${metric('Awaiting review', s.pending, 'Candidates need human judgment')}${metric('Accepted', s.accepted, 'Source-matched or human-checked')}${metric('Direct complaint groups', s.direct_groups, 'Exact repeats grouped')}${metric('Counterevidence', s.contradictions, 'Accepted contradicting records')}</div>${s.pending === 0 ? `<div class="notice good"><strong>Evidence review is complete.</strong> Continue to Results to inspect coverage, source gaps, and the next action. ${navLink('results', 'Continue to Results')}</div>` : ''}<div class="agent-hint"><strong>Use the research agents to extract candidates.</strong><p>They read stored source text and propose evidence; you make the acceptance decision. Billed search usage is in your Brave dashboard; agent-session usage is not metered here.</p><button data-action="analyze">Ask agent to analyze sources</button></div><div class="filters"><select id="evidence-filter" aria-label="Review status filter">${options(['all', 'pending', 'accepted', 'rejected'], evidenceFilter)}</select><select id="audience-filter" aria-label="Audience filter">${options(['all', ...run.app.audiences], audienceFilter)}</select><span class="help">${visible.length} records</span></div>${visible.length ? visible.map(evidenceCard).join('') : empty('Evidence starts with the source.', 'Collect or import source text, then ask the agent to extract candidates or add an exact quote yourself. Nothing is accepted automatically.')}${candidate}${importForm}<details class="card"><summary>Import JSON or CSV source records</summary><form id="batch-import-form" class="stack"><label>Format<select name="format"><option value="json">JSON</option><option value="csv">CSV</option></select></label><label>Source records<textarea name="data" rows="8" required placeholder="Paste source records with url, content, and provenance_note."></textarea></label><p class="help">Up to 100 records / 1 MB. Optional fields: title, family, context_id, published_at. All records are validated before the import is saved.</p><button>Import records</button></form></details><details class="card"><summary>Inspect or annotate collected sources</summary>${data.sources.filter(s => s.content_chars).map(s => `<div class="source-row"><span>${esc(s.title)}<br><small>${esc(s.family)} · ${s.published_at || 'Date unknown'} · ${esc(human(s.analysis_status))}</small></span><div class="row"><button data-action="annotate" data-id="${s.id}">Annotate</button><button data-action="analysis-done" data-id="${s.id}">Mark analyzed</button><button data-action="delete-source" data-id="${s.id}" class="danger">Delete source</button></div></div>`).join('') || '<p class="help">No readable source text yet.</p>'}</details>`;
}
function evidenceCard(e) {
  const source = data.sources.find(s => s.id === e.source_id);
  return `<article class="card"><div class="card-top"><span class="eyebrow">${esc(e.audience)} · ${esc(e.relevance)}</span>${badge(e.review_status)}</div><blockquote class="evidence-quote">${esc(e.quote || 'Source removed')}</blockquote><div class="row">${badge(e.direction)}${badge(e.verification)}<span class="help">Unprompted: ${esc(e.unprompted)}</span></div><p>${esc(e.rationale)}</p><a class="source-link" href="${esc(source?.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(source?.title || 'Source')}</a><details><summary>Source context & review history</summary><div class="context">${esc(e.context)}</div><p class="help">${esc(source?.family)} · ${source?.published_at || 'Date unknown'} · Evidence ${e.id.slice(0, 12)}</p>${data.reviews.filter(r => r.evidence_id === e.id).map(r => `<p class="help">${esc(r.reviewer)} · ${esc(r.decision)} · ${date(r.created_at)}<br>${esc(r.reason)}</p>`).join('')}</details>${data.selected.status !== 'completed' && e.review_status !== 'invalidated' ? `<form class="review-form stack" data-id="${e.id}"><details><summary>Correct classification</summary><div class="split"><label>Audience<select name="audience">${options(data.selected.app.audiences, e.audience)}</select></label><label>Relevance<select name="relevance">${options(['direct', 'adjacent', 'irrelevant'], e.relevance)}</select></label><label>Direction<select name="direction">${options(['supports', 'contradicts', 'mixed/unclear'], e.direction)}</select></label><label>Unprompted<select name="unprompted">${options(['unknown', 'yes', 'no'], e.unprompted)}</select></label></div><label>Rationale<textarea name="rationale" required>${esc(e.rationale)}</textarea></label><label>Consequence<input name="consequence" value="${esc(e.consequence)}"></label><label>Workaround<input name="workaround" value="${esc(e.workaround)}"></label><label>Spending signal<input name="spending_signal" value="${esc(e.spending_signal)}"></label></details><label>Review reason<input name="reason" required placeholder="Why does this support or challenge the hypothesis?"></label>${e.verification === 'imported_unverified' ? '<label class="check"><input type="checkbox" name="source_checked">I checked this excerpt against its original source and context.</label>' : ''}<div class="toolbar"><button name="decision" value="accepted" class="primary">Accept evidence</button><button name="decision" value="rejected">Reject</button><button name="decision" value="pending">Save correction</button></div></form>` : ''}</article>`;
}
function resultsView() {
  const app = activeApp(), s = data.app_summary;
  if (!app || !s) return empty('Your findings will live here.', 'Select an app idea to see consolidated evidence across its research runs.', navLink('runs', 'Plan research'));
  const runRows = s.runs.map(r => `<div class="source-row"><span>${esc(r.id.slice(0, 8))} · ${badge(r.status)}<br><small>${r.summary.accepted} accepted · ${r.summary.pending} pending · ${r.summary.queries_done}/${r.summary.queries_planned} searches</small></span><span class="help">Coverage ${r.summary.coverage_complete ? 'complete' : 'incomplete'} · Analysis ${r.summary.analysis_complete ? 'complete' : 'pending'} · Review ${r.summary.review_complete ? 'complete' : 'pending'}</span></div>`).join('');
  return `<div class="notice ${s.ready ? 'good' : ''}"><strong>${s.ready ? 'Ready to investigate in conversations.' : 'Consolidated research is not yet ready for an interview-readiness verdict.'}</strong><br>These results combine all ${s.run_count} runs for ${esc(app.name)}. Five actual conversations are still pending; Day 1 does not prove willingness to pay.</div><div class="metrics">${metric('Distinct complaints', s.complaint_groups, 'Across all runs')}${metric('Direct groups', s.direct_groups, 'Recent, across all runs')}${metric('Counterevidence', s.contradictions, 'Accepted contradictions across all runs')}${metric('Source families', s.families.length, s.families.join(', ') || 'Classification pending')}</div><div class="grid wide"><section><div class="card"><h2>Readiness by audience · all runs</h2>${s.audiences.map(a => `<div style="margin-top:20px"><div class="card-top"><h3>${esc(a.audience)}</h3>${badge(a.passed ? 'thresholds_met' : 'incomplete')}</div>${[['Recent direct groups', a.direct_groups, app.criteria.direct], ['Independent contexts', a.contexts, app.criteria.contexts], ['Source families', a.families, app.criteria.families], ['Consequences / workarounds', a.consequences, app.criteria.consequences]].map(([label, value, target]) => `<div class="criteria"><span>${label}</span><strong>${value} / ${target}</strong></div>`).join('')}</div>`).join('')}<p class="help">Unknown publication dates do not satisfy recency. Different quotes from one thread are one context. Criteria are from the app brief; evidence is deduplicated across runs.</p></div><div class="card"><h2>Consolidated research pack</h2><p class="help">This version includes reviewed evidence and coverage from every run for this app. It becomes stale when any included run changes.</p><button data-action="export" class="primary">Generate consolidated research pack</button><div style="margin-top:18px">${data.app_artifacts.slice().reverse().map(a => `<div class="source-row"><span>Version ${a.version} · ${date(a.created_at)}${a.stale ? '<br><span class="help">Stale after research changes</span>' : ''}</span><button data-action="artifact" data-id="${a.id}" ${a.stale ? 'disabled' : ''}>View & download</button></div>`).join('')}</div>${cachedArtifact ? `<div class="toolbar" style="margin-top:18px">${Object.keys(cachedArtifact.files).map(file => `<button data-action="download" data-file="${file}">${file}</button>`).join('')}</div><pre class="report">${esc(cachedArtifact.files['demand-evidence.md'])}</pre>` : ''}</div></section><section><div class="card"><h2>Combined coverage</h2>${[['Runs included', s.run_count], ['Queries completed', `${s.queries_done}/${s.queries_planned}`], ['Sources discovered', s.sources], ['Sources fetched', s.fetched], ['Candidates', s.candidates], ['Accepted evidence', s.accepted], ['Awaiting review', s.pending], ['Collection coverage in every run', s.coverage_complete ? 'Complete' : 'Incomplete'], ['Source analysis in every run', s.analysis_complete ? 'Complete' : 'Pending'], ['Evidence review in every run', s.review_complete ? 'Complete' : 'Pending'], ['Failed sources', s.failed_sources]].map(([label, value]) => `<div class="criteria"><span>${label}</span><strong>${value}</strong></div>`).join('')}<p class="help">An inaccessible source is a coverage gap, not a finding about demand.</p></div><div class="card"><h2>Run history</h2>${runRows || '<p class="help">No research runs yet.</p>'}<p class="help">Evidence is reviewed within each run; this page combines accepted evidence from all runs belonging to this app idea.</p></div></section></div>`;
}
async function loadSource(sourceId) {
  if (!sourceId) { currentSource = null; document.querySelector('#source-context').textContent = 'Select a source.'; return; }
  currentSource = await tool('source_get', { run_id: selection.run_id, source_id: sourceId });
  document.querySelector('#source-context').textContent = currentSource.content;
}
async function onSubmit(event) {
  event.preventDefault(); if (busy) return;
  busy = true;
  const form = event.currentTarget, values = Object.fromEntries(new FormData(form)), run_id = selection.run_id;
  try {
    if (form.id === 'idea-form') {
      const config = { ...values, audiences: values.audiences.split('\n').map(x => x.trim()).filter(Boolean), hypotheses: values.hypotheses.split('\n').filter(x => x.trim()).map((statement, i) => ({ id: `H${i + 1}`, statement })) };
      const app_id = values.app_id || undefined;
      config.criteria = Object.fromEntries(['direct', 'contexts', 'families', 'consequences', 'months'].map(k => [k, Number(values[k])]));
      const a = await tool('app_save', { app_id, config }); selection = { app_id: a.id }; saveSelection();
    } else if (form.id === 'run-form') {
      const queries = [...form.querySelectorAll('[data-query]')].map(e => ({ query: e.value, audience: e.dataset.audience, intent: e.dataset.intent }));
      const budgets = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
      const run = await tool('run_create', { app_id: selection.app_id, queries, budgets }); selection.run_id = run.id; saveSelection();
    } else if (form.id === 'settings-form') {
      if (values.key.trim()) await api('/api/plugin-config/app-research', { values: { brave_api_key: values.key.trim() } });
      form.reset();
    } else if (form.id === 'limits-form') {
      const limits = Object.fromEntries(['queries', 'documents', 'minutes'].map(k => [k, Number(values[k])]));
      await tool('run_limits_update', { run_id, ...limits });
    } else if (form.id === 'import-form') { await tool('source_import', { run_id, ...values });
    } else if (form.id === 'batch-import-form') { await tool('sources_import', { run_id, ...values });
    } else if (form.id === 'candidate-form') {
      await tool('evidence_record', { run_id, ...values, hypothesis_ids: new FormData(form).getAll('hypothesis_ids') });
    } else if (form.classList.contains('review-form')) {
      const { reason, source_checked, ...corrections } = values;
      await tool('evidence_review', { run_id, evidence_id: form.dataset.id, decision: event.submitter.value, reason, source_checked: source_checked === 'on', corrections });
    } else if (form.id === 'outcome-form') { await tool('outcome_record', { run_id, ...values }); }
    cachedArtifact = null;
    await refresh(); status('Saved to your research workspace.');
  } catch (e) { status(e.message, true); } finally { busy = false; }
}
async function onAction(event) {
  const button = event.currentTarget, action = button.dataset.action, run_id = selection.run_id;
  try {
    if (action === 'select-app') { selection = { app_id: button.dataset.id }; saveSelection(); await refresh();
    } else if (action === 'edit-app') {
      const app = data.apps.find(a => a.id === button.dataset.id), form = document.querySelector('#idea-form');
      form.elements.app_id.value = app.id;
      for (const k of ['name', 'brief', 'country', 'language']) form.elements[k].value = app[k];
      form.elements.audiences.value = app.audiences.join('\n'); form.elements.hypotheses.value = app.hypotheses.map(h => h.statement).join('\n');
      for (const [k, v] of Object.entries(app.criteria)) form.elements[k].value = v;
      dirty = true; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); status('Editing this brief. Existing research runs keep their original version.');
    } else if (action === 'new-app') { document.querySelector('#idea-form').reset(); document.querySelector('#idea-form').elements.app_id.value = ''; dirty = false;
    } else if (action === 'select-run') { selection.run_id = button.dataset.id; saveSelection(); location.href = `runs.html?token=${encodeURIComponent(token)}`;
    } else if (action === 'delete-run') {
      const targetRunId = button.dataset.id;
      const confirmRunId = prompt(`Permanently delete this run and all its sources, evidence, reviews, and exports?\n\nType the exact run ID to confirm:\n${targetRunId}`);
      if (confirmRunId === targetRunId) {
        await tool('run_delete', { run_id: targetRunId, confirm_run_id: confirmRunId });
        if (selection.run_id === targetRunId) { selection = { app_id: selection.app_id }; cachedArtifact = null; }
        saveSelection(); await refresh(); status('Run and its research data were deleted.');
      }
    } else if (action === 'collect') {
      if (data.selected.status === 'paused') await tool('run_control', { run_id, action: 'resume' });
      collecting = true; render(); status('Collecting sources. Progress is saved after every step.');
      try {
        while (collecting) {
          const run = await tool('collect', { run_id });
          if (!['queued', 'running'].includes(run.status)) collecting = false;
          await refresh();
          if (collecting) await new Promise(resolve => setTimeout(resolve, 500));
        }
        status(`Collection stopped: ${human(data.selected.stop_reason || data.selected.status)}.`);
      } finally { collecting = false; render(); }
    } else if (['pause', 'cancel', 'retry_failed'].includes(action)) {
      collecting = false; await tool('run_control', { run_id, action }); await refresh(); status(`Run ${human(action)} recorded.`);
    } else if (action === 'analyze') {
      button.disabled = true; status('Analysis requested. Follow the agent in workspace chat; candidates will appear here.');
      await api('/api/agent/turn', { prompt: `Analyze stored source snapshots for research run ${run_id}, app ${selection.app_id}. First call research_dashboard to get the frozen hypotheses and source IDs. Dashboard source rows are metadata only: call research_source_get for each and analyze only non-empty content whose status is not failed or deleted. Skip blank-text, failed, deleted, and metadata-only sources as source-access gaps; do not call research_analysis_done for them. Delegate extraction with both target aliases: delegate(agent="demand-analyst", preferred_agent="demand-analyst", task="..."). Delegate the independent challenge with delegate(agent="demand-skeptic", preferred_agent="demand-skeptic", task="..."). Both agent and preferred_agent are required for compatibility across local and hosted Bahulam runtimes; never call delegate with task alone. Include the run ID, readable source IDs, and frozen hypotheses in each delegated task. Record only exact source-matched candidates with research_evidence_record. Use only relevance values direct, adjacent, or irrelevant; direction values supports, contradicts, or mixed/unclear; unprompted values yes, no, or unknown. After evaluating each readable source, call research_analysis_done even if evidence recording fails and note that failure. Do not accept evidence, record an outcome, or issue new searches. Preserve contradictions and unknowns. Search-call counts are shown here; billed usage is in your Brave dashboard. Agent-session usage is not metered here.` });
      await refresh(); status('Agent turn finished. Review the evidence and source analysis status.');
    } else if (action === 'annotate') {
      const source = await tool('source_get', { run_id, source_id: button.dataset.id });
      const form = document.querySelector('#import-form'); form.closest('details').open = true;
      for (const key of ['url', 'content', 'title', 'family', 'context_id', 'published_at', 'provenance_note']) form.elements[key].value = source[key] || '';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'analysis-done') {
      const note = prompt('Describe what you found in this source, including if no useful evidence exists:');
      if (note) { await tool('analysis_done', { run_id, source_id: button.dataset.id, note }); await refresh(); }
    } else if (action === 'delete-source') {
      const reason = prompt('Why remove this source? Its text and dependent export contents will be deleted:');
      if (reason) { await tool('source_remove', { run_id, source_id: button.dataset.id, reason }); cachedArtifact = null; await refresh(); }
    } else if (action === 'export') { cachedArtifact = await tool('export', { app_id: selection.app_id }); await refresh(); status('Consolidated research pack generated. Download the files below.');
    } else if (action === 'artifact') { cachedArtifact = await tool('artifact_get', { app_id: selection.app_id, artifact_id: button.dataset.id }); render();
    } else if (action === 'download') {
      const current = await tool('artifact_get', { app_id: selection.app_id, artifact_id: cachedArtifact.id });
      const filename = button.dataset.file, blob = new Blob([current.files[filename]], { type: filename.endsWith('.md') ? 'text/markdown' : 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) { status(e.message, true); button.disabled = false; }
}
// Bahulam emits named SSE events. Avoid replacing an operator's unsaved form.
try {
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  let timer;
  stream.addEventListener('plugin_state_changed', () => {
    clearTimeout(timer); timer = setTimeout(() => {
      if (!busy && !collecting && !dirty && !document.querySelector('form:focus-within') && !document.querySelector('details[open] form')) refresh().catch(e => status(e.message, true));
    }, 800);
  });
  window.addEventListener('pagehide', () => { collecting = false; stream.close(); });
} catch {}
window.addEventListener('storage', e => { if (e.key === 'app-research.selection' && !busy && !collecting) { selection = readSelection(); currentSource = null; cachedArtifact = null; refresh().catch(e => status(e.message, true)); } });
refresh().then(() => {
  if (panel === 'ideas' && new URLSearchParams(location.search).get('new') === '1') beginNewIdea();
}).catch(e => status(e.message, true));
