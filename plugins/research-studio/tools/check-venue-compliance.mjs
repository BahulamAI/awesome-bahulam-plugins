/**
 * check_venue_compliance — cross-check the document against its venue
 * pack's constraints (required sections, length limits, bib style).
 * Pure query. Returns { ok, issues[], warnings[] }.
 */
import { loadDocument } from './lib.mjs';
import { loadVenue } from './venue.mjs';

export async function call(args = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const pack = loadVenue(doc.venue);
  if (!pack) return { success: false, output: `No venue pack for "${doc.venue}". Run apply_venue_template first.` };

  const issues = [];
  const warnings = [];

  // Required sections present?
  const outlineIds = new Set((doc.outline || []).map(s => s.id));
  for (const rid of pack.required_sections || []) {
    if (!outlineIds.has(rid)) issues.push({ kind: 'missing_section', section: rid });
  }

  // Bib style match?
  const expectedBibStyle = pack.bib_style;
  if (expectedBibStyle && doc.meta?.bib_style && doc.meta.bib_style !== expectedBibStyle) {
    warnings.push({ kind: 'bib_style_mismatch', expected: expectedBibStyle, actual: doc.meta.bib_style });
  }

  // Length constraints (approximate: 500 words/page)
  const totalWords = (doc.outline || []).reduce((n, s) => n + (doc.sections?.[s.id]?.content?.split(/\s+/).filter(Boolean).length || 0), 0);
  const approxPages = Math.round(totalWords / 500);
  if (pack.length?.hard_limit_pages && approxPages > pack.length.hard_limit_pages) {
    issues.push({ kind: 'over_hard_limit', approx_pages: approxPages, hard_limit: pack.length.hard_limit_pages });
  }
  if (pack.length?.target_pages && approxPages > pack.length.target_pages) {
    warnings.push({ kind: 'over_target', approx_pages: approxPages, target: pack.length.target_pages });
  }
  if (approxPages < 1) warnings.push({ kind: 'empty_or_near_empty', approx_pages: approxPages });

  return {
    success: true,
    output: {
      venue: doc.venue,
      ok: issues.length === 0,
      approx_pages: approxPages,
      total_words: totalWords,
      issues,
      warnings,
    },
  };
}
