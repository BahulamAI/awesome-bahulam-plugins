/**
 * add_todo — record a TODO marker. Surfaces in the compiled Markdown
 * so authors can find open loops before compiling final targets.
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { genId } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const { slug, section, text, cwd } = args;
  if (!slug || !text) return { success: false, output: '`slug` and `text` required.' };
  const doc = await loadOrCreate({ slug, cwd });
  doc.todos = doc.todos || [];
  const id = genId(doc.todos.map(t => t.id), 'todo');
  doc.todos.push({ id, ...(section ? { section } : {}), text });
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id, section: section || null, md_path: paths.md } };
}
