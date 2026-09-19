/**
 * dedupe_references — merge duplicate references.
 *
 * Priority for match:
 *   1. Exact DOI match.
 *   2. (Title normalized) + year match.
 * Winner is the entry with the most populated fields. Losing ids are
 * rewritten in all section.cites lists to point at the winner.
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fieldCount(e) {
  return Object.values(e?.fields || {}).filter(v => v != null && v !== '').length;
}

export async function call(args = {}, options = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  doc.references = doc.references || {};

  const entries = Object.entries(doc.references);
  const byKey = new Map();
  const winnerOf = {}; // losingId -> winningId

  for (const [id, e] of entries) {
    const doi = String(e.fields?.doi || '').toLowerCase();
    const key = doi ? `doi:${doi}` : `title:${normalizeTitle(e.fields?.title)}|${e.fields?.year || ''}`;
    if (!key || key === 'title:|') continue;
    if (byKey.has(key)) {
      const winning = byKey.get(key);
      const winner = fieldCount(doc.references[winning]) >= fieldCount(e) ? winning : id;
      const loser  = winner === winning ? id : winning;
      winnerOf[loser] = winner;
      byKey.set(key, winner);
    } else {
      byKey.set(key, id);
    }
  }

  // Rewrite section cites
  for (const sec of Object.values(doc.sections || {})) {
    if (!Array.isArray(sec.cites)) continue;
    sec.cites = [...new Set(sec.cites.map(c => winnerOf[c] || c))];
  }
  // Rewrite claims supported_by
  for (const c of (doc.claims || [])) {
    if (Array.isArray(c.supported_by)) {
      c.supported_by = c.supported_by.map(r => winnerOf[r] || r);
    }
  }
  // Delete losing entries
  for (const losing of Object.keys(winnerOf)) delete doc.references[losing];

  const paths = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      merged: Object.entries(winnerOf).map(([loser, winner]) => ({ loser, winner })),
      remaining: Object.keys(doc.references).length,
      md_path: paths.md, bib_path: paths.bib,
    },
  };
}
