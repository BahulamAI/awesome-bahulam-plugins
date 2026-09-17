/**
 * apply_venue_template — apply a venue pack's defaults to a document.
 *
 * Reads config/venues/<key>.yaml, then:
 *   - sets doc.venue
 *   - sets doc.meta.bib_style (if provided by pack)
 *   - reconciles doc.outline against the pack's required_sections
 *     (missing sections are appended with default target_words)
 *   - stashes the pack under doc.meta.venue_pack for downstream tools
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { loadVenue, listVenues } from './venue.mjs';

export async function call(args = {}, options = {}) {
  const { slug, venue, cwd } = args;
  if (!slug || !venue) return { success: false, output: '`slug` and `venue` required.' };
  const pack = loadVenue(venue);
  if (!pack) return { success: false, output: `Unknown venue "${venue}". Available: ${listVenues().join(', ')}` };

  const doc = await loadOrCreate({ slug, cwd });
  doc.venue = venue;
  doc.meta = doc.meta || {};
  if (pack.bib_style) doc.meta.bib_style = pack.bib_style;
  doc.meta.venue_pack = { key: venue, applied_at: new Date().toISOString() };

  // Reconcile required sections
  const outlineIds = new Set((doc.outline || []).map(s => s.id));
  const required = Array.isArray(pack.required_sections) ? pack.required_sections : [];
  const appended = [];
  for (const rid of required) {
    if (!outlineIds.has(rid)) {
      // Default heading is the id in title case
      const heading = String(rid).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      doc.outline.push({ id: rid, heading, target_words: 300 });
      appended.push(rid);
    }
  }

  const paths = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      venue,
      bib_style: doc.meta.bib_style || null,
      required_sections: required,
      appended_sections: appended,
      md_path: paths.md,
    },
  };
}
