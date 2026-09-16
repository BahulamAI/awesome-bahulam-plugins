/**
 * add_note — attach a free-form note to a section (or unattached).
 *
 * Notes are surfaced in the compiled Markdown at the end (for review)
 * and passed to the Draft Agent as context when it drafts the section
 * they're attached to.
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { genId } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const { slug, section, text, author, cwd } = args;
  if (!slug || !text) return { success: false, output: '`slug` and `text` required.' };
  const doc = await loadOrCreate({ slug, cwd });
  doc.notes = doc.notes || [];
  const id = genId(doc.notes.map(n => n.id), 'note');
  doc.notes.push({ id, ...(section ? { section } : {}), ...(author ? { author } : {}), text });
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id, section: section || null, md_path: paths.md } };
}
