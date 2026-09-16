/**
 * list_sources — return the source manifest for a document.
 */
import { loadDocument } from './lib.mjs';

export async function call(args = {}) {
  const { slug, kind, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const entries = Object.entries(doc.sources || {})
    .filter(([, s]) => !kind || s.kind === kind)
    .map(([id, s]) => ({ id, ...s }));
  return { success: true, output: { count: entries.length, sources: entries } };
}
