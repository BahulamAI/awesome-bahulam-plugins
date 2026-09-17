/**
 * add_section — insert a section into the outline (append by default,
 * or after a given id).
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, id, heading, target_words, after, cwd } = args;
  if (!slug || !id || !heading) return { success: false, output: '`slug`, `id`, `heading` required.' };
  const doc = await loadOrCreate({ slug, cwd });
  doc.outline = doc.outline || [];
  if (doc.outline.some(s => s.id === id)) return { success: false, output: `Section id "${id}" already exists.` };
  const entry = { id, heading, ...(target_words != null ? { target_words } : {}) };
  if (after) {
    const idx = doc.outline.findIndex(s => s.id === after);
    if (idx < 0) return { success: false, output: `after: section "${after}" not found.` };
    doc.outline.splice(idx + 1, 0, entry);
  } else {
    doc.outline.push(entry);
  }
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id, position: doc.outline.findIndex(s => s.id === id), md_path: paths.md } };
}
