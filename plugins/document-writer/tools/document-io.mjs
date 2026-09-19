/**
 * document-io.mjs — high-level document load/save wrapper.
 *
 * Individual mutation tools import loadOrCreate + saveAndSync from here.
 */
import fs from 'node:fs';
import {
  emptyDocument, loadDocument, saveDocument, docPaths, ensureDocDir,
  appendEvent, upsertDocumentRow, SLUG_RE, VALID_KINDS, nowIso,
  documentWordCount,
} from './lib.mjs';

export async function loadOrCreate({ slug, title, kind, venue, authors, cwd }) {
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug "${slug}"`);
  let doc = loadDocument(slug, cwd);
  if (!doc) {
    doc = emptyDocument({ slug, title: title || slug, kind, venue, authors });
    ensureDocDir(slug, cwd);
    await saveDocument(doc, cwd, { snapshot: false });
  }
  return doc;
}

export async function saveAndSync(doc, cwd, options = {}) {
  const paths = await saveDocument(doc, cwd, options);
  const state = options?.state ? await options.state : null;
  if (state) {
    upsertDocumentRow(state, {
      slug: doc.slug,
      title: doc.title,
      kind: doc.kind,
      venue: doc.venue,
      dslPath: paths.json,
      mdPath: paths.md,
      status: doc.status || 'draft',
      wordCount: documentWordCount(doc),
    });
    appendEvent(state, 'documents', {
      name: doc.slug, title: doc.title, kind: doc.kind, venue: doc.venue,
      path: paths.md, dsl_path: paths.json,
      word_count: documentWordCount(doc), created_at: nowIso(),
    });
  }
  return paths;
}

// ── tool: create_document ───────────────────────────────────────────────
export async function callCreateDocument(args = {}, options = {}) {
  const { name, title, kind = 'research_paper', venue = 'arxiv', authors = [], cwd } = args;
  if (!name || !SLUG_RE.test(name)) {
    return { success: false, output: `Invalid slug "${name}". Use lowercase alphanumeric + hyphens.` };
  }
  if (!VALID_KINDS.has(kind)) {
    return { success: false, output: `Invalid kind "${kind}". One of: ${[...VALID_KINDS].join(', ')}` };
  }
  const doc = emptyDocument({ slug: name, title: title || name, kind, venue, authors });
  const paths = await saveAndSync(doc, cwd, { ...options, snapshot: false });
  return {
    success: true,
    output: {
      slug: name,
      title: doc.title,
      kind,
      venue,
      dsl_path: paths.json,
      md_path: paths.md,
      bib_path: paths.bib,
    },
  };
}

// ── tool: get_document ──────────────────────────────────────────────────
export async function callGetDocument(args = {}) {
  const { slug, cwd, full = false } = args;
  if (!slug) return { success: false, output: '`slug` is required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found. Call create_document first.` };

  if (full) return { success: true, output: doc };

  // Compact summary
  const totalWords = documentWordCount(doc);
  const sectionSummaries = (doc.outline || []).map(s => {
    const content = doc.sections?.[s.id]?.content || '';
    const wc = content ? content.trim().split(/\s+/).filter(Boolean).length : 0;
    return {
      id: s.id, heading: s.heading,
      target_words: s.target_words || 0,
      actual_words: wc,
      cites: (doc.sections?.[s.id]?.cites || []).length,
      figures: (doc.sections?.[s.id]?.figures || []).length,
      claims: (doc.sections?.[s.id]?.claims || []).length,
    };
  });
  const unsupportedClaims = (doc.claims || []).filter(c => c.verified !== true).length;
  return {
    success: true,
    output: {
      slug: doc.slug,
      kind: doc.kind,
      venue: doc.venue,
      title: doc.title,
      authors: doc.authors,
      total_words: totalWords,
      sections: sectionSummaries,
      reference_count: Object.keys(doc.references || {}).length,
      source_count: Object.keys(doc.sources || {}).length,
      figure_count: (doc.figures || []).length,
      claim_count: (doc.claims || []).length,
      unsupported_claims: unsupportedClaims,
      todo_count: (doc.todos || []).length,
      note_count: (doc.notes || []).length,
      dsl_path: docPaths(doc.slug, cwd).json,
      md_path: docPaths(doc.slug, cwd).md,
      bib_path: docPaths(doc.slug, cwd).bib,
    },
  };
}

export const call = callCreateDocument;

// ── tool: snapshot_document ─────────────────────────────────────────────
export async function callSnapshot(args = {}) {
  const { slug, cwd, label } = args;
  if (!slug) return { success: false, output: '`slug` is required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const paths = docPaths(slug, cwd);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const name = label ? `${ts}-${String(label).replace(/[^a-z0-9-_]/gi, '_')}.json` : `${ts}.json`;
  const snap = `${paths.snapshots}/${name}`;
  fs.writeFileSync(snap, JSON.stringify(doc, null, 2), 'utf-8');
  return { success: true, output: { snapshot_path: snap } };
}
