/**
 * reorder_sections — reorder the outline by an explicit id list. The
 * new order must contain exactly the same set of ids that currently
 * exist (no adds/removes here — use add_section / delete_section).
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, order, cwd } = args;
  if (!slug || !Array.isArray(order) || !order.length) {
    return { success: false, output: '`slug` and non-empty `order` array required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const existing = (doc.outline || []).map(s => s.id);
  const set = new Set(existing);
  if (order.length !== existing.length || !order.every(id => set.has(id))) {
    return { success: false, output: { message: 'order must be a permutation of existing section ids', existing, provided: order } };
  }
  const byId = new Map(doc.outline.map(s => [s.id, s]));
  doc.outline = order.map(id => byId.get(id));
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { order, md_path: paths.md } };
}
