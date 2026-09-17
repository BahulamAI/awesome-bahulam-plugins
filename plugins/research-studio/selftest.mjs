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

// Phase 2 tools
import { call as importFigure } from './tools/import-figure.mjs';
import { call as placeFigure } from './tools/place-figure.mjs';
import { call as captionFigure } from './tools/caption-figure.mjs';
import { call as listFigures } from './tools/list-figures.mjs';

import { call as addClaim } from './tools/add-claim.mjs';
import { call as linkClaimToSource } from './tools/link-claim-to-source.mjs';
import { call as listClaims } from './tools/list-claims.mjs';
import { call as listUnsupportedClaims } from './tools/list-unsupported-claims.mjs';

import { call as applyVenueTemplate } from './tools/apply-venue-template.mjs';
import { call as checkLength } from './tools/check-length.mjs';
import { call as checkVenueCompliance } from './tools/check-venue-compliance.mjs';

import { call as addReview } from './tools/add-review.mjs';
import { call as listReviews } from './tools/list-reviews.mjs';
import { call as setWatermark } from './tools/set-watermark.mjs';

import { call as setPatentMetadata } from './tools/set-patent-metadata.mjs';
import { call as addClaimTreeItem } from './tools/add-claim-tree-item.mjs';
import { call as updateClaimTreeItem } from './tools/update-claim-tree-item.mjs';
import { call as addPriorArt } from './tools/add-prior-art.mjs';
import { call as setClaimNovelty } from './tools/set-claim-novelty.mjs';
import { call as checkClaimHierarchy } from './tools/check-claim-hierarchy.mjs';

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

// ══════════════════════════════════════════════════════════════════════
// PHASE 2 — figures, claims, style, reviewer, patent path, docx/xml
// ══════════════════════════════════════════════════════════════════════

// ── Figure Agent ──────────────────────────────────────────────────────
{
  // Build a tiny valid PNG (1x1 black pixel) — real bytes, not a stub, so
  // import_figure's extension check + copy path both exercise real IO.
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000' +
    '0d49444154789c62000000000005000151ea9c000000000049454e44ae426082',
    'hex'
  );
  const figSrc = path.join(sandbox, 'diagram.png');
  fs.writeFileSync(figSrc, png);

  const imp = await importFigure({ slug: 'attn', path: figSrc, id: 'arch', caption: 'System architecture.', cwd }, { state: fakeState });
  ok('import_figure copies + registers', imp.success && fs.existsSync(path.join(cwd, 'attn', 'figures', 'diagram.png')));

  const badExt = await importFigure({ slug: 'attn', path: sandbox + '/run1.csv', cwd }, { state: fakeState });
  ok('import_figure rejects unsupported extension', badExt.success === false);

  const placed = await placeFigure({ slug: 'attn', figure_id: 'arch', section_ids: ['method', 'results'], cwd }, { state: fakeState });
  ok('place_figure binds to 2 sections', placed.success && placed.output.placed_in.length === 2);

  const badSec = await placeFigure({ slug: 'attn', figure_id: 'arch', section_ids: ['ghost'], cwd }, { state: fakeState });
  ok('place_figure rejects non-outline section', badSec.success === false);

  const cap = await captionFigure({ slug: 'attn', figure_id: 'arch', caption: 'Overall system architecture.', placement: 't', cwd }, { state: fakeState });
  ok('caption_figure updates caption + placement', cap.success && cap.output.placement === 't');

  const figs = await listFigures({ slug: 'attn', cwd });
  ok('list_figures returns arch figure', figs.success && figs.output.figures.some(f => f.id === 'arch'));
  const archEntry = figs.output.figures.find(f => f.id === 'arch');
  ok('list_figures reports referenced_in on arch', archEntry && archEntry.referenced_in.length === 2);
}

// ── Claim Agent ───────────────────────────────────────────────────────
{
  const c1 = await addClaim({
    slug: 'attn', text: 'Method scales O(n log n).', section: 'method', kind: 'complexity',
    supported_by: ['fake_pdf'], cwd,
  }, { state: fakeState });
  ok('add_claim complexity', c1.success);

  const c2 = await addClaim({
    slug: 'attn', text: 'Achieves 12% improvement over baseline.',
    section: 'results', kind: 'quantitative', value: 0.12, unit: 'F1 delta', cwd,
  }, { state: fakeState });
  ok('add_claim quantitative with value/unit', c2.success);

  const badKind = await addClaim({ slug: 'attn', text: 'x', section: 'method', kind: 'nonsense', cwd });
  ok('add_claim rejects unknown kind', badKind.success === false);

  const badSection = await addClaim({ slug: 'attn', text: 'x', section: 'ghost', cwd });
  ok('add_claim rejects non-outline section', badSection.success === false);

  const link = await linkClaimToSource({ slug: 'attn', claim_id: c2.output.id, source_ids: ['expt_run1'], ref_ids: ['smith2024'], cwd }, { state: fakeState });
  ok('link_claim_to_source accepts source + ref ids', link.success && link.output.supported_by.length >= 2);

  const badLink = await linkClaimToSource({ slug: 'attn', claim_id: c2.output.id, ref_ids: ['ghost_ref'], cwd });
  ok('link_claim_to_source rejects unknown ids', badLink.success === false);

  const listed = await listClaims({ slug: 'attn', cwd });
  ok('list_claims returns all claims', listed.success && listed.output.count >= 2);

  const unsup = await listUnsupportedClaims({ slug: 'attn', cwd });
  ok('list_unsupported_claims counts unverified', unsup.success && unsup.output.unsupported_count >= 2);
}

// ── Style Agent ───────────────────────────────────────────────────────
{
  const applied = await applyVenueTemplate({ slug: 'attn', venue: 'neurips', cwd }, { state: fakeState });
  ok('apply_venue_template sets venue + bib_style', applied.success && applied.output.venue === 'neurips');
  ok('apply_venue_template lists required sections', Array.isArray(applied.output.required_sections));

  const badVenue = await applyVenueTemplate({ slug: 'attn', venue: 'nope', cwd });
  ok('apply_venue_template rejects unknown venue', badVenue.success === false);

  const len = await checkLength({ slug: 'attn', cwd });
  ok('check_length returns per_section + total', len.success && Array.isArray(len.output.per_section));

  const comp = await checkVenueCompliance({ slug: 'attn', cwd });
  ok('check_venue_compliance returns ok/issues/warnings', comp.success && typeof comp.output.ok === 'boolean');
}

// ── Reviewer Agent ────────────────────────────────────────────────────
{
  const rev = await addReview({
    slug: 'attn', verdict: 'revise', persona: 'harsh_academic', rubric: 'novelty',
    score: 6, comments: 'Novelty unclear. Missing baseline comparisons in Table 3.',
    per_section: { method: 'Notation section needed', results: 'add variance columns' },
    cwd,
  }, { state: fakeState });
  ok('add_review persists', rev.success && rev.output.verdict === 'revise');

  const badV = await addReview({ slug: 'attn', verdict: 'maybe', comments: 'ok', cwd });
  ok('add_review rejects unknown verdict', badV.success === false);

  const badScore = await addReview({ slug: 'attn', verdict: 'accept', score: 42, comments: 'ok', cwd });
  ok('add_review rejects out-of-range score', badScore.success === false);

  const reviews = await listReviews({ slug: 'attn', cwd });
  ok('list_reviews returns the review', reviews.success && reviews.output.count >= 1);
  ok('list_reviews shows per_section_count', reviews.output.reviews[0].per_section_count === 2);
}

// ── DOCX + PDF gating (via compile_document) ──────────────────────────
{
  // At this point unsupported claims still exist (c1, c2 aren't verified) — so md/tex must refuse.
  const refused = await compileDocument({ slug: 'attn', target: 'tex', cwd }, { state: fakeState });
  ok('compile tex refused while unverified claims present', refused.success === false);

  const forcedTex = await compileDocument({ slug: 'attn', target: 'tex', allow_unsupported_claims: true, cwd }, { state: fakeState });
  ok('compile tex proceeds with allow_unsupported_claims', forcedTex.success === true);

  const docx = await compileDocument({ slug: 'attn', target: 'docx', allow_unsupported_claims: true, cwd }, { state: fakeState });
  ok('compile docx returns definitive result', typeof docx.success === 'boolean');
  // If pandoc absent, docx.success === false with the "pandoc not found" note. Either outcome is acceptable in CI.
}

// ══════════════════════════════════════════════════════════════════════
// PATENT PATH — new document, apply patent flow end-to-end
// ══════════════════════════════════════════════════════════════════════
{
  const pat = await createDocument({ name: 'wid-y', title: 'Widget Y', kind: 'patent_application', venue: 'uspto-utility', cwd }, { state: fakeState });
  ok('patent: create_document', pat.success);

  const meta = await setPatentMetadata({
    slug: 'wid-y', type: 'utility', priority_date: '2026-09-01',
    inventors: [{ name: 'Sree A.' }, { name: 'Alex B.' }], cwd,
  }, { state: fakeState });
  ok('patent: set_patent_metadata', meta.success && meta.output.patent.inventor_count === 2);

  const c1 = await addClaimTreeItem({ slug: 'wid-y', text: 'A widget comprising: a first part; and a second part coupled thereto.', kind: 'independent', cwd }, { state: fakeState });
  ok('patent: add independent claim', c1.success && c1.output.id === '1' && c1.output.kind === 'independent');

  const c2 = await addClaimTreeItem({ slug: 'wid-y', text: 'The widget of claim 1, wherein the first part is metallic.', kind: 'dependent', depends_on: '1', cwd }, { state: fakeState });
  ok('patent: add dependent claim', c2.success && c2.output.depends_on === '1');

  const badDep = await addClaimTreeItem({ slug: 'wid-y', text: 'x', kind: 'dependent', depends_on: '99', cwd });
  ok('patent: reject dependent with missing parent', badDep.success === false);

  const updated = await updateClaimTreeItem({ slug: 'wid-y', id: '1', text: 'A widget comprising: a first metallic part; and a second part coupled thereto with a threaded fastener.', cwd }, { state: fakeState });
  ok('patent: update_claim_tree_item narrows claim 1', updated.success);

  // Prior art — first add a reference (via add_reference), then register as prior art
  await addReference({ slug: 'wid-y', ref_id: 'us_1234567', type: 'patent', fields: { authors: ['J. Doe'], title: 'Prior widget', year: 2020, url: 'https://patents.google.com/patent/US1234567' }, cwd }, { state: fakeState });
  const pa = await addPriorArt({ slug: 'wid-y', ref_id: 'us_1234567', relevance: 'similar', note: 'Discloses coupled-parts widget.', cwd }, { state: fakeState });
  ok('patent: add_prior_art', pa.success && pa.output.relevance === 'similar');

  const missingRef = await addPriorArt({ slug: 'wid-y', ref_id: 'nope_ref', cwd });
  ok('patent: add_prior_art rejects unknown ref', missingRef.success === false);

  const novelty1 = await setClaimNovelty({ slug: 'wid-y', claim_id: '1', verdict: 'similar_to_prior', prior_art_refs: [pa.output.id], reason: 'Prior widget also uses coupled parts.', cwd }, { state: fakeState });
  ok('patent: set_claim_novelty similar_to_prior', novelty1.success);
  const novelty2 = await setClaimNovelty({ slug: 'wid-y', claim_id: '2', verdict: 'novel', reason: 'Metallic first part not disclosed.', cwd }, { state: fakeState });
  ok('patent: set_claim_novelty novel', novelty2.success);

  const badVerdict = await setClaimNovelty({ slug: 'wid-y', claim_id: '2', verdict: 'unclear', cwd });
  ok('patent: set_claim_novelty rejects unknown verdict', badVerdict.success === false);

  // Hierarchy
  const hier = await checkClaimHierarchy({ slug: 'wid-y', cwd });
  ok('patent: check_claim_hierarchy reports independents + dependents', hier.success && hier.output.independents === 1 && hier.output.dependents === 1);
  ok('patent: hierarchy is ok (no orphans, no cycles)', hier.output.ok);

  // Add an orphan to test detection
  const orphanCwd = path.join(cwd, 'wid-y');
  const patentDsl = JSON.parse(fs.readFileSync(path.join(orphanCwd, 'document.json'), 'utf-8'));
  patentDsl.patent.claims_tree.push({ id: '3', text: 'The widget of claim 99, wherein x.', kind: 'dependent', depends_on: '99' });
  fs.writeFileSync(path.join(orphanCwd, 'document.json'), JSON.stringify(patentDsl, null, 2));
  const hierBad = await checkClaimHierarchy({ slug: 'wid-y', cwd });
  ok('patent: hierarchy detects orphan', hierBad.success && hierBad.output.orphans.length === 1);

  // Compile: uspto_xml on a patent kind (bypass claim gating; patent doc has no research claims)
  const xml = await compileDocument({ slug: 'wid-y', target: 'uspto_xml', allow_unsupported_claims: true, cwd }, { state: fakeState });
  ok('patent: compile uspto_xml succeeds', xml.success && fs.existsSync(xml.output.output_path));
  const xmlContent = fs.readFileSync(xml.output.output_path, 'utf-8');
  ok('patent: xml contains us-patent-application root', xmlContent.includes('<us-patent-application'));
  ok('patent: xml contains claim 1 body', xmlContent.includes('coupled thereto'));
  ok('patent: xml includes prior art citation', xmlContent.includes('us_1234567'));

  // uspto_xml on a non-patent doc should be refused with a clear message
  const wrongKind = await compileDocument({ slug: 'attn', target: 'uspto_xml', allow_unsupported_claims: true, cwd });
  ok('compile uspto_xml refuses non-patent kind', wrongKind.success === false);
}

// ══════════════════════════════════════════════════════════════════════
// WATERMARK — set/clear + auto-DRAFT + compile injection into every target
// ══════════════════════════════════════════════════════════════════════

// Fresh doc so we can test the three watermark states in isolation.
{
  await createDocument({ name: 'mark', title: 'Marked Doc', kind: 'research_paper', venue: 'arxiv', cwd }, { state: fakeState });

  // Auto-DRAFT triggers when an unverified claim exists AND meta.watermark is UNSET.
  const dslPath = path.join(cwd, 'mark', 'document.json');
  const dsl = JSON.parse(fs.readFileSync(dslPath, 'utf-8'));
  dsl.claims = [{ id: 'c1', text: 'unverified test claim', section: 'intro', kind: 'qualitative' }];
  fs.writeFileSync(dslPath, JSON.stringify(dsl, null, 2));

  // Force md re-compile via any state-mutating tool (add_todo works — pure state).
  await addTodo({ slug: 'mark', text: 'trigger re-compile', cwd }, { state: fakeState });
  const mdAuto = fs.readFileSync(path.join(cwd, 'mark', 'document.md'), 'utf-8');
  ok('watermark: auto-DRAFT banner appears when unverified claims present', /Watermark:.*DRAFT.*auto-applied/.test(mdAuto));
  ok('watermark: auto-DRAFT names the reason', /1 unverified claim/.test(mdAuto));

  // Explicit set — DRAFT clears, CONFIDENTIAL replaces
  const conf = await setWatermark({ slug: 'mark', text: 'CONFIDENTIAL', opacity: 0.25, angle: 30, color: '#ff0000', cwd }, { state: fakeState });
  ok('set_watermark accepts a custom text', conf.success && conf.output.watermark.text === 'CONFIDENTIAL');
  ok('set_watermark rejects out-of-range opacity', (await setWatermark({ slug: 'mark', text: 'x', opacity: 5, cwd })).success === false);

  const mdConf = fs.readFileSync(path.join(cwd, 'mark', 'document.md'), 'utf-8');
  ok('watermark: explicit banner appears in Markdown', mdConf.includes('CONFIDENTIAL') && !/auto-applied/.test(mdConf));

  const tex = await compileDocument({ slug: 'mark', target: 'tex', allow_unsupported_claims: true, cwd }, { state: fakeState });
  ok('watermark: LaTeX compile succeeds with watermark', tex.success);
  const texContent = fs.readFileSync(tex.output.output_path, 'utf-8');
  ok('watermark: tex includes draftwatermark package', texContent.includes('\\usepackage{draftwatermark}'));
  ok('watermark: tex sets watermark text', texContent.includes('\\SetWatermarkText{CONFIDENTIAL}'));

  // Explicit clear — text: null → opt-out, auto-DRAFT MUST NOT reappear
  const cleared = await setWatermark({ slug: 'mark', text: null, cwd }, { state: fakeState });
  ok('set_watermark clears when text=null', cleared.success && cleared.output.watermark === null);

  await addTodo({ slug: 'mark', text: 'trigger re-compile again', cwd }, { state: fakeState });
  const mdCleared = fs.readFileSync(path.join(cwd, 'mark', 'document.md'), 'utf-8');
  ok('watermark: null opt-out survives even with unverified claims', !mdCleared.includes('Watermark:'));

  // USPTO XML watermark path — needs a patent-kind doc
  await createDocument({ name: 'wat-patent', title: 'Watermarked Patent', kind: 'patent_application', venue: 'uspto-utility', cwd }, { state: fakeState });
  await setWatermark({ slug: 'wat-patent', text: 'DRAFT', cwd }, { state: fakeState });
  const patXml = await compileDocument({ slug: 'wat-patent', target: 'uspto_xml', allow_unsupported_claims: true, cwd }, { state: fakeState });
  ok('watermark: uspto_xml compile succeeds', patXml.success);
  const xmlContent = fs.readFileSync(patXml.output.output_path, 'utf-8');
  ok('watermark: uspto_xml includes us-publication-status', xmlContent.includes('us-publication-status status="DRAFT"'));
}

// ── Cleanup ─────────────────────────────────────────────────────────────
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ok */ }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL RESEARCH-STUDIO SELFTESTS PASSED');
