/**
 * Shared utility helpers for research-studio tools.
 *
 * Two responsibilities:
 *   1. Durable state helpers (SQLite + append streams).
 *   2. Document DSL helpers — load, mutate, save, snapshot, regenerate.
 *
 * The DSL lives at <docDir>/document.json and is the source of truth.
 * document.md and refs.bib are regenerated on every save via
 * document-compile.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const VALID_KINDS = new Set(['research_paper', 'patent_application', 'report', 'grant', 'review']);
export const VALID_VENUES = new Set(['arxiv', 'ieee-conf', 'neurips', 'acl', 'acm', 'uspto-utility', 'epo-utility', 'nsf-grant', 'custom']);

export function nowIso() {
  return new Date().toISOString();
}

// ── SQL state helpers ────────────────────────────────────────────────────
export function hasSqlState(state) {
  return state && typeof state.query === 'function';
}

export function run(state, sql, params = []) {
  if (!hasSqlState(state)) return null;
  try { return state.query(sql, params); } catch { return null; }
}

export function rows(state, sql, params = []) {
  if (!hasSqlState(state)) return [];
  try { return state.query(sql, params) || []; } catch { return []; }
}

export function appendEvent(state, stream, payload) {
  if (!state || typeof state.append !== 'function') return false;
  try { state.append(stream, payload); return true; } catch { return false; }
}

// ── Document folder resolution ───────────────────────────────────────────
export function resolveDocDir(slug, cwd) {
  const root = cwd ? path.resolve(String(cwd)) : process.cwd();
  return path.join(root, slug);
}

export function ensureDocDir(slug, cwd) {
  const dir = resolveDocDir(slug, cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sources', 'extracted'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sources', 'notes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'figures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  return dir;
}

export function docPaths(slug, cwd) {
  const dir = resolveDocDir(slug, cwd);
  return {
    dir,
    json: path.join(dir, 'document.json'),
    md: path.join(dir, 'document.md'),
    bib: path.join(dir, 'refs.bib'),
    sources: path.join(dir, 'sources'),
    extracted: path.join(dir, 'sources', 'extracted'),
    notesDir: path.join(dir, 'sources', 'notes'),
    figures: path.join(dir, 'figures'),
    snapshots: path.join(dir, 'snapshots'),
    exports: path.join(dir, 'exports'),
  };
}

// ── Document DSL shape ───────────────────────────────────────────────────
// (See config/reference/document-dsl.md for the full spec.)

export function emptyDocument({ slug, title, kind = 'research_paper', venue = 'arxiv', authors = [] } = {}) {
  const t = nowIso();
  return {
    version: 1,
    slug,
    kind,
    venue,
    title: title || slug,
    authors,
    abstract: '',
    keywords: [],

    outline: defaultOutlineFor(kind),
    sections: {},         // id -> { content, cites, figures, claims }
    references: {},       // ref_id -> { type, fields }
    figures: [],          // { id, path, caption, placement, referenced_in }
    sources: {},          // src_id -> { kind, path, extracted_path?, ref_id? }
    claims: [],           // { id, text, section, kind, supported_by, verified }
    notes: [],            // { id, section?, author?, text }
    todos: [],            // { id, section?, text }

    // Patent-only (populated by patent flow)
    patent: kind === 'patent_application' ? emptyPatent() : null,

    meta: { created_at: t, updated_at: t, compiled_targets: [] },
  };
}

function emptyPatent() {
  return {
    type: 'utility',
    priority_date: null,
    inventors: [],
    claims_tree: [],
    prior_art: [],
  };
}

function defaultOutlineFor(kind) {
  switch (kind) {
    case 'patent_application':
      return [
        { id: 'field',        heading: 'Field of the Invention',       target_words: 100 },
        { id: 'background',   heading: 'Background',                   target_words: 400 },
        { id: 'summary',      heading: 'Summary',                      target_words: 300 },
        { id: 'drawings',     heading: 'Brief Description of Drawings', target_words: 200 },
        { id: 'detailed',     heading: 'Detailed Description',         target_words: 1500 },
        { id: 'claims',       heading: 'Claims',                       target_words: 400 },
        { id: 'abstract_pat', heading: 'Abstract',                     target_words: 150 },
      ];
    case 'grant':
      return [
        { id: 'summary',     heading: 'Project Summary',    target_words: 250 },
        { id: 'objectives',  heading: 'Objectives',         target_words: 400 },
        { id: 'background',  heading: 'Background',         target_words: 500 },
        { id: 'approach',    heading: 'Approach',           target_words: 800 },
        { id: 'timeline',    heading: 'Timeline',           target_words: 200 },
        { id: 'budget',      heading: 'Budget Justification', target_words: 400 },
        { id: 'impact',      heading: 'Broader Impact',     target_words: 300 },
      ];
    case 'review':
      return [
        { id: 'intro',      heading: 'Introduction',     target_words: 500 },
        { id: 'landscape',  heading: 'Landscape',        target_words: 1500 },
        { id: 'analysis',   heading: 'Analysis',         target_words: 1000 },
        { id: 'gaps',       heading: 'Open Problems',    target_words: 500 },
        { id: 'conclusion', heading: 'Conclusion',       target_words: 300 },
      ];
    case 'report':
      return [
        { id: 'summary',   heading: 'Executive Summary', target_words: 200 },
        { id: 'method',    heading: 'Method',            target_words: 600 },
        { id: 'results',   heading: 'Results',           target_words: 600 },
        { id: 'next',      heading: 'Next Steps',        target_words: 200 },
      ];
    case 'research_paper':
    default:
      return [
        { id: 'intro',       heading: 'Introduction',   target_words: 800 },
        { id: 'related',     heading: 'Related Work',   target_words: 500 },
        { id: 'method',      heading: 'Method',         target_words: 1200 },
        { id: 'experiments', heading: 'Experiments',    target_words: 900 },
        { id: 'results',     heading: 'Results',        target_words: 600 },
        { id: 'discussion',  heading: 'Discussion',     target_words: 400 },
        { id: 'conclusion',  heading: 'Conclusion',     target_words: 200 },
      ];
  }
}

// ── DSL query & mutation primitives ──────────────────────────────────────
export function loadDocument(slug, cwd) {
  const p = docPaths(slug, cwd);
  if (!fs.existsSync(p.json)) return null;
  try { return JSON.parse(fs.readFileSync(p.json, 'utf-8')); } catch { return null; }
}

/**
 * Save the document DSL and regenerate document.md + refs.bib.
 * Also drops a snapshot into snapshots/<timestamp>.json unless
 * opts.snapshot === false.
 */
export async function saveDocument(doc, cwd, opts = {}) {
  if (!doc?.slug) throw new Error('saveDocument: doc.slug required');
  doc.meta = doc.meta || {};
  doc.meta.updated_at = nowIso();
  if (!doc.meta.created_at) doc.meta.created_at = doc.meta.updated_at;

  const p = docPaths(doc.slug, cwd);
  ensureDocDir(doc.slug, cwd);

  fs.writeFileSync(p.json, JSON.stringify(doc, null, 2), 'utf-8');

  if (opts.snapshot !== false) {
    const ts = doc.meta.updated_at.replace(/[:.]/g, '-');
    try { fs.writeFileSync(path.join(p.snapshots, `${ts}.json`), JSON.stringify(doc, null, 2)); } catch { /* ignore */ }
  }

  const compileMod = opts.compile || (await import('./document-compile.mjs'));
  const md = compileMod.compileMarkdown(doc);
  fs.writeFileSync(p.md, md, 'utf-8');

  const bib = compileMod.compileBibtex(doc);
  fs.writeFileSync(p.bib, bib, 'utf-8');

  return p;
}

export function findSection(doc, id) {
  return (doc.outline || []).find(s => s.id === id) || null;
}

export function sectionContent(doc, id) {
  return doc.sections?.[id]?.content || '';
}

export function setSectionContent(doc, id, content) {
  doc.sections = doc.sections || {};
  doc.sections[id] = { ...(doc.sections[id] || {}), content };
}

export function genId(existingIds, prefix = 'x') {
  const used = new Set(existingIds || []);
  let i = 1;
  while (used.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

export function wordCount(str) {
  if (!str) return 0;
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

export function documentWordCount(doc) {
  return (doc.outline || []).reduce((sum, s) => sum + wordCount(sectionContent(doc, s.id)), 0);
}

// ── State row helpers ────────────────────────────────────────────────────
export function upsertDocumentRow(state, { slug, title, kind, venue, dslPath, mdPath, status = 'draft', wordCount = 0 }) {
  if (!hasSqlState(state)) return;
  const now = nowIso();
  try {
    const existing = state.query('SELECT id FROM research_documents WHERE slug = ?', [slug]) || [];
    if (existing.length) {
      state.query(
        `UPDATE research_documents
           SET title = ?, kind = ?, venue = ?, dsl_path = ?, md_path = ?, status = ?, word_count = ?, updated_at = ?
         WHERE slug = ?`,
        [title, kind, venue, dslPath, mdPath, status, wordCount, now, slug],
      );
    } else {
      state.query(
        `INSERT INTO research_documents
           (slug, title, kind, venue, dsl_path, md_path, status, word_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [slug, title, kind, venue, dslPath, mdPath, status, wordCount, now, now],
      );
    }
  } catch { /* table may not exist in tests */ }
}
