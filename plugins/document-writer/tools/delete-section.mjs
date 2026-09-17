/**
 * delete_section — remove a section (outline entry + content).
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, id, cwd } = args;
  if (!slug || !id) return { success: false, output: '`slug` and `id` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const before = (doc.outline || []).length;
  doc.outline = (doc.outline || []).filter(s => s.id !== id);
  if (doc.outline.length === before) return { success: false, output: `Section "${id}" not found.` };
  if (doc.sections) delete doc.sections[id];
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { removed: id, remaining: doc.outline.length, md_path: paths.md } };
}
