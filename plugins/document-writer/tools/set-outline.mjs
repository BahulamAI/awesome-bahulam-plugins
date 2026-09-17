/**
 * set_outline — replace the entire section outline.
 *
 * Existing section content is preserved for sections whose ids appear
 * in the new outline; content for dropped sections is discarded.
 * Callers should snapshot_document first if they want reversibility.
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, sections, cwd } = args;
  if (!slug || !Array.isArray(sections) || !sections.length) {
    return { success: false, output: '`slug` and non-empty `sections` array required.' };
  }
  for (const s of sections) {
    if (!s.id || !s.heading) return { success: false, output: 'Each section needs `id` and `heading`.' };
  }
  const doc = await loadOrCreate({ slug, cwd });

  // Preserve existing content for surviving ids
  const preserved = {};
  for (const s of sections) {
    if (doc.sections?.[s.id]) preserved[s.id] = doc.sections[s.id];
  }
  doc.outline = sections.map(s => ({
    id: s.id, heading: s.heading,
    ...(s.target_words != null ? { target_words: s.target_words } : {}),
    ...(s.depends_on ? { depends_on: s.depends_on } : {}),
    ...(s.subsections ? { subsections: s.subsections } : {}),
  }));
  doc.sections = preserved;

  const paths = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      section_count: doc.outline.length,
      preserved_content_for: Object.keys(preserved),
      md_path: paths.md,
    },
  };
}
