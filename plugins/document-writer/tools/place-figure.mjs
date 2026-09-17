/**
 * place_figure — bind a registered figure to one or more sections.
 *
 * Adds the figure id to each section's `figures[]` (so the compiler
 * emits it inline) AND records the section ids on the figure's
 * `referenced_in[]` for cross-reference.
 *
 * Args:
 *   slug*         - document slug
 *   figure_id*    - id in doc.figures
 *   section_ids*  - array of outline section ids
 *   cwd
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, figure_id, section_ids, cwd } = args;
  if (!slug || !figure_id || !Array.isArray(section_ids) || !section_ids.length) {
    return { success: false, output: '`slug`, `figure_id`, `section_ids[]` required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const fig = (doc.figures || []).find(f => f.id === figure_id);
  if (!fig) return { success: false, output: `Figure "${figure_id}" not found.` };

  const outlineIds = new Set((doc.outline || []).map(s => s.id));
  const missing = section_ids.filter(id => !outlineIds.has(id));
  if (missing.length) return { success: false, output: `Sections not in outline: ${missing.join(', ')}` };

  doc.sections = doc.sections || {};
  fig.referenced_in = fig.referenced_in || [];
  for (const sid of section_ids) {
    doc.sections[sid] = doc.sections[sid] || {};
    const list = new Set(doc.sections[sid].figures || []);
    list.add(figure_id);
    doc.sections[sid].figures = [...list];
    if (!fig.referenced_in.includes(sid)) fig.referenced_in.push(sid);
  }
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { figure_id, placed_in: section_ids, md_path: paths.md } };
}
