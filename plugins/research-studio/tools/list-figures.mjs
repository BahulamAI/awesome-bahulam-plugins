/**
 * list_figures — return the figure manifest for a document.
 */
import { loadDocument } from './lib.mjs';

export async function call(args = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const figures = (doc.figures || []).map(f => ({
    id: f.id, path: f.path, caption: f.caption || '',
    placement: f.placement || 'h',
    referenced_in: f.referenced_in || [],
    has_description: Boolean(f.description),
  }));
  return { success: true, output: { count: figures.length, figures } };
}
