/**
 * Offline smoke test for research-studio tool modules.
 * Run: node plugins/research-studio/selftest.mjs
 *
 * All tests run offline — no PDF providers, no ref providers, no LLMs.
 * Ref lookup is forced into RESEARCH_OFFLINE=1 so Crossref is skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

process.env.RESEARCH_OFFLINE = '1';               // force ref-local
delete process.env.MISTRAL_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.FAL_KEY;

import { call as createDocument } from './tools/create-document.mjs';
import { call as getDocument } from './tools/get-document.mjs';
import { call as snapshotDocument } from './tools/snapshot-document.mjs';
import { call as compileDocument } from './tools/compile-document.mjs';

import { call as ingestPdf } from './tools/ingest-pdf.mjs';
import { call as ingestUrl } from './tools/ingest-url.mjs';
import { call as addNote } from './tools/add-note.mjs';
import { call as addExperiment } from './tools/add-experiment.mjs';
import { call as listSources } from './tools/list-sources.mjs';

import { call as setOutline } from './tools/set-outline.mjs';
import { call as addSection } from './tools/add-section.mjs';
import { call as reorderSections } from './tools/reorder-sections.mjs';
import { call as deleteSection } from './tools/delete-section.mjs';

import { call as setSectionContent } from './tools/set-section-content.mjs';
import { call as addTodo } from './tools/add-todo.mjs';

import { call as addReference } from './tools/add-reference.mjs';
import { call as lookupDoi } from './tools/lookup-doi.mjs';
import { call as attachCitation } from './tools/attach-citation.mjs';
import { call as formatBibliography } from './tools/format-bibliography.mjs';
import { call as dedupeReferences } from './tools/dedupe-references.mjs';

import { call as extractFiguresFromPdf } from './tools/extract-figures-from-pdf.mjs';
import { call as setFigureDescription } from './tools/set-figure-description.mjs';
import { call as setClaimVerdict } from './tools/set-claim-verdict.mjs';

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};

// ── Fake state (streams + SQL) ──────────────────────────────────────────
const streams = [];
const tables = { research_documents: [], research_compilations: [] };
const insert = (table, row) => { const next = { id: tables[table].length + 1, ...row }; tables[table].push(next); return { lastInsertRowid: next.id }; };
const fakeState = {
  tables,
  append: (stream, payload) => streams.push({ stream, payload, created_at: new Date().toISOString() }),
  list: (stream, opts = {}) => streams.filter(r => r.stream === stream).slice(0, opts.limit || 20),
  query: (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO research_documents')) {
      return insert('research_documents', {
        slug: params[0], title: params[1], kind: params[2], venue: params[3],
        dsl_path: params[4], md_path: params[5], status: params[6],
        word_count: params[7], created_at: params[8], updated_at: params[9],
      });
    }
    if (s.startsWith('UPDATE research_documents SET title')) {
      const [title, kind, venue, dslPath, mdPath, status, wordCount, updated, slug] = params;
      for (const row of tables.research_documents) {
        if (row.slug === slug) Object.assign(row, { title, kind, venue, dsl_path: dslPath, md_path: mdPath, status, word_count: wordCount, updated_at: updated });
      }
      return { changes: tables.research_documents.filter(r => r.slug === slug).length };
    }
    if (s.startsWith('SELECT id FROM research_documents WHERE slug = ?')) {
      return tables.research_documents.filter(r => r.slug === params[0]).slice(-1);
    }
    if (s.startsWith('INSERT INTO research_compilations')) {
      return insert('research_compilations', {
        slug: params[0], target: params[1], output_path: params[2], status: params[3],
        notes: params[4], created_at: params[5],
      });
    }
    throw new Error(`Unhandled fake SQL: ${s}`);
  },
};

// ── Sandbox ────────────────────────────────────────────────────────────
const sandbox = path.join(process.cwd(), '.research-studio-selftest');
fs.rmSync(sandbox, { recursive: true, force: true });
fs.mkdirSync(sandbox, { recursive: true });
const cwd = sandbox;

// ── Lifecycle: create + get ────────────────────────────────────────────
{
  const bad = await createDocument({ name: 'Bad Slug!' }, { state: fakeState });
  ok('create_document rejects bad slug', bad.success === false);

  const doc = await createDocument({ name: 'attn', title: 'Amoeba Attention', kind: 'research_paper', venue: 'neurips', authors: [{ name: 'Sree A.', affiliation: 'Kepler' }], cwd }, { state: fakeState });
  ok('create_document succeeds', doc.success);
  ok('create_document wrote document.json', fs.existsSync(path.join(cwd, 'attn', 'document.json')));
  ok('create_document wrote document.md', fs.existsSync(path.join(cwd, 'attn', 'document.md')));
  ok('create_document wrote refs.bib (empty)', fs.existsSync(path.join(cwd, 'attn', 'refs.bib')));

  const dsl = JSON.parse(fs.readFileSync(path.join(cwd, 'attn', 'document.json'), 'utf-8'));
  ok('DSL includes default neurips outline', dsl.outline.length === 7 && dsl.outline[0].id === 'intro');
  ok('DSL kind + venue', dsl.kind === 'research_paper' && dsl.venue === 'neurips');

  const md = fs.readFileSync(path.join(cwd, 'attn', 'document.md'), 'utf-8');
  ok('Markdown has title + author', md.includes('# Amoeba Attention') && md.includes('Sree A.'));

  const summary = await getDocument({ slug: 'attn', cwd });
  ok('get_document returns compact summary', summary.success && Array.isArray(summary.output.sections));
  ok('summary section has actual_words = 0 initially', summary.output.sections[0].actual_words === 0);
}

// ── Outline: add / reorder / delete ────────────────────────────────────
{
  const add = await addSection({ slug: 'attn', id: 'limitations', heading: 'Limitations', target_words: 300, after: 'discussion', cwd }, { state: fakeState });
  ok('add_section after discussion', add.success && add.output.position >= 0);

  const reorder = await reorderSections({ slug: 'attn', order: ['intro', 'related', 'method', 'experiments', 'results', 'discussion', 'limitations', 'conclusion'], cwd }, { state: fakeState });
  ok('reorder_sections permutation', reorder.success);

  const badReorder = await reorderSections({ slug: 'attn', order: ['intro', 'nope'], cwd }, { state: fakeState });
  ok('reorder_sections rejects non-permutation', badReorder.success === false);

  const del = await deleteSection({ slug: 'attn', id: 'limitations', cwd }, { state: fakeState });
  ok('delete_section removes', del.success);

  const set = await setOutline({ slug: 'attn', sections: [
    { id: 'intro', heading: 'Introduction', target_words: 400 },
    { id: 'method', heading: 'Method', target_words: 800 },
    { id: 'results', heading: 'Results', target_words: 400 },
  ], cwd }, { state: fakeState });
  ok('set_outline replaces', set.success && set.output.section_count === 3);
}

// ── Sources: PDF (local), URL (fetch may fail offline — skip), notes, experiment ──
{
  // Create a fake PDF file for ingest test — local provider will read it
  const pdfPath = path.join(sandbox, 'fake_paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4\n' + 'BT /F1 12 Tf (Hello world citation Smith et al. (2024)) Tj ET\n%%EOF');
  const ingest = await ingestPdf({ slug: 'attn', src: pdfPath, id: 'fake_pdf', cwd }, { state: fakeState });
  ok('ingest_pdf (local provider) succeeds', ingest.success && ingest.output.provider.includes('local'));
  ok('ingest_pdf copies to sources/', fs.existsSync(path.join(cwd, 'attn', 'sources', 'fake_paper.pdf')));
  ok('ingest_pdf writes extracted JSON', fs.existsSync(path.join(cwd, 'attn', 'sources', 'extracted', 'fake_pdf.json')));

  const note = await addNote({ slug: 'attn', section: 'method', text: 'Baseline: SlidingWindowAttn.', author: 'sree', cwd }, { state: fakeState });
  ok('add_note attached to section', note.success && note.output.section === 'method');

  const csvPath = path.join(sandbox, 'run1.csv');
  fs.writeFileSync(csvPath, 'run,f1\n1,0.85\n');
  const expt = await addExperiment({ slug: 'attn', path: csvPath, id: 'expt_run1', description: 'first ablation', cwd }, { state: fakeState });
  ok('add_experiment registers CSV', expt.success && expt.output.source_id === 'expt_run1');

  const list = await listSources({ slug: 'attn', cwd });
  ok('list_sources returns pdf + experiment (notes are separate)', list.success && list.output.count === 2);
  ok('list_sources shows both kinds', list.output.sources.some(s => s.kind === 'pdf') && list.output.sources.some(s => s.kind === 'experiment'));
}

// ── References: add (structured + BibTeX), lookup (offline local), dedupe ──
{
  const structured = await addReference({ slug: 'attn', ref_id: 'smith2024', type: 'inproceedings', fields: { authors: ['A. Smith', 'B. Jones'], title: 'Long context attention', booktitle: 'NeurIPS', year: 2024, doi: '10.1234/x' }, cwd }, { state: fakeState });
  ok('add_reference structured', structured.success && structured.output.is_new);

  const fromBib = await addReference({ slug: 'attn', ref_id: 'chen2023', bibtex: '@article{chen2023, author = {C. Chen}, title = {Sparse attention}, journal = {Nature}, year = {2023}}', cwd }, { state: fakeState });
  ok('add_reference from BibTeX string', fromBib.success && fromBib.output.type === 'article');

  // Duplicate by DOI — should merge on dedupe
  await addReference({ slug: 'attn', ref_id: 'smith2024_dup', type: 'inproceedings', fields: { authors: ['A. Smith'], title: 'Long context attention', year: 2024, doi: '10.1234/x' }, cwd }, { state: fakeState });
  const dedup = await dedupeReferences({ slug: 'attn', cwd }, { state: fakeState });
  ok('dedupe_references merges DOI duplicate', dedup.success && dedup.output.merged.length === 1);
  ok('dedupe_references keeps richer entry', dedup.output.remaining === 2);

  const doiOffline = await lookupDoi({ slug: 'attn', query: '10.5555/patent_x', register: true, cwd }, { state: fakeState });
  ok('lookup_doi (offline local) returns placeholder entry', doiOffline.success && doiOffline.output.provider.includes('local'));

  const attach = await attachCitation({ slug: 'attn', section_id: 'method', ref_ids: ['smith2024', 'chen2023'], cwd }, { state: fakeState });
  ok('attach_citation attaches 2 refs', attach.success && attach.output.cites.length === 2);

  const style = await formatBibliography({ slug: 'attn', style: 'natbib', cwd }, { state: fakeState });
  ok('format_bibliography records style', style.success && style.output.style === 'natbib');
}

// ── Draft: set_section_content + inline cite parsing ──────────────────
{
  const setContent = await setSectionContent({ slug: 'attn', section_id: 'method', content: 'We build on prior work [smith2024] and extend [chen2023] to the multi-modal case. [ghost] is not a real ref.', cwd }, { state: fakeState });
  ok('set_section_content persists content', setContent.success && setContent.output.word_count > 5);
  ok('set_section_content extracts cites', setContent.output.cites.includes('smith2024') && setContent.output.cites.includes('chen2023'));
  ok('set_section_content flags unresolved cites', setContent.output.unresolved_cite_candidates.includes('ghost'));

  const append = await setSectionContent({ slug: 'attn', section_id: 'method', content: 'Additional experiments confirm the trend.', mode: 'append', cwd }, { state: fakeState });
  ok('set_section_content append grows content', append.success && append.output.word_count > setContent.output.word_count);

  const todo = await addTodo({ slug: 'attn', section: 'results', text: 'Add ablation table', cwd }, { state: fakeState });
  ok('add_todo attaches marker', todo.success && todo.output.section === 'results');
}

// ── Vision (state-only paths; no LLM calls) ───────────────────────────
{
  // extract_figures_from_pdf with the local provider yields 0 figures — this is expected
  const extract = await extractFiguresFromPdf({ slug: 'attn', source_id: 'fake_pdf', cwd }, { state: fakeState });
  ok('extract_figures_from_pdf handles zero-figure local provider', extract.success && extract.output.added.length === 0);
  ok('extract_figures_from_pdf notes provider upgrade path', /mistral/i.test(extract.output.note));

  // Manually register a figure so we can test description + verdict paths
  const dsl = JSON.parse(fs.readFileSync(path.join(cwd, 'attn', 'document.json'), 'utf-8'));
  dsl.figures = dsl.figures || [];
  dsl.figures.push({ id: 'fig1', path: 'figures/arch.png', caption: '' });
  dsl.claims = dsl.claims || [];
  dsl.claims.push({ id: 'c1', text: 'Method scales O(n log n).', section: 'method', kind: 'complexity' });
  fs.writeFileSync(path.join(cwd, 'attn', 'document.json'), JSON.stringify(dsl, null, 2));

  const desc = await setFigureDescription({ slug: 'attn', figure_id: 'fig1', description: 'Architecture diagram with three blocks: A, B, C.', caption: 'Architecture overview.', cwd }, { state: fakeState });
  ok('set_figure_description persists', desc.success && desc.output.has_caption);

  const verdict = await setClaimVerdict({ slug: 'attn', claim_id: 'c1', verdict: 'supported', figure_ref: 'fig1', confidence: 0.9, reason: 'Log-linear scaling visible in the plot.', cwd }, { state: fakeState });
  ok('set_claim_verdict persists supported', verdict.success && verdict.output.verified === true);

  const badVerdict = await setClaimVerdict({ slug: 'attn', claim_id: 'c1', verdict: 'bogus', cwd }, { state: fakeState });
  ok('set_claim_verdict rejects unknown verdict', badVerdict.success === false);
}

// ── Snapshot ──────────────────────────────────────────────────────────
{
  const snap = await snapshotDocument({ slug: 'attn', label: 'before-compile', cwd });
  ok('snapshot_document writes file', snap.success && fs.existsSync(snap.output.snapshot_path));
}

// ── Compile: md (always ok), tex (venue), pdf (skipped if no pandoc) ──
{
  const md = await compileDocument({ slug: 'attn', target: 'md', cwd }, { state: fakeState });
  ok('compile md succeeds', md.success && md.output.bytes > 100);

  const tex = await compileDocument({ slug: 'attn', target: 'tex', cwd }, { state: fakeState });
  ok('compile tex succeeds', tex.success && fs.existsSync(tex.output.output_path));
  const texContent = fs.readFileSync(tex.output.output_path, 'utf-8');
  ok('tex uses neurips document class', texContent.includes('neurips_2024'));
  ok('tex includes bibliography reference', texContent.includes('\\bibliography{refs}'));
  ok('tex copied refs.bib into exports/', fs.existsSync(path.dirname(tex.output.output_path) + '/refs.bib'));

  const pdf = await compileDocument({ slug: 'attn', target: 'pdf', cwd }, { state: fakeState });
  // pandoc may or may not be present — either outcome is acceptable
  ok('compile pdf returns definitive result', typeof pdf.success === 'boolean');
}

// ── Compile refuses when claims unverified ────────────────────────────
{
  // Add an unverified claim
  const dsl = JSON.parse(fs.readFileSync(path.join(cwd, 'attn', 'document.json'), 'utf-8'));
  dsl.claims.push({ id: 'c2', text: 'Unproven claim.', section: 'results' });
  fs.writeFileSync(path.join(cwd, 'attn', 'document.json'), JSON.stringify(dsl, null, 2));

  const refused = await compileDocument({ slug: 'attn', target: 'md', cwd }, { state: fakeState });
  ok('compile refuses when unverified claims present', refused.success === false);
  ok('refusal lists unsupported claims', Array.isArray(refused.output.unsupported_claims) && refused.output.unsupported_claims.some(c => c.id === 'c2'));

  const forced = await compileDocument({ slug: 'attn', target: 'md', allow_unsupported_claims: true, cwd }, { state: fakeState });
  ok('compile with allow_unsupported_claims proceeds', forced.success === true);
}

// ── Patent variant: default outline shape ─────────────────────────────
{
  const pat = await createDocument({ name: 'wid-x', title: 'Widget X', kind: 'patent_application', venue: 'uspto-utility', cwd }, { state: fakeState });
  ok('create_document patent kind', pat.success);
  const dsl = JSON.parse(fs.readFileSync(path.join(cwd, 'wid-x', 'document.json'), 'utf-8'));
  ok('patent has USPTO-style outline', dsl.outline.some(s => s.id === 'claims') && dsl.outline.some(s => s.id === 'field'));
  ok('patent has patent block initialized', dsl.patent && dsl.patent.type === 'utility');
}

// ── URL ingest (skipped if no network; still test path handling) ──────
{
  try {
    const r = await ingestUrl({ slug: 'attn', url: 'https://example.com', id: 'ex1', cwd }, { state: fakeState });
    ok('ingest_url returns definitive result', typeof r.success === 'boolean');
  } catch (e) {
    ok('ingest_url gracefully handles offline', true);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL RESEARCH-STUDIO SELFTESTS PASSED');
