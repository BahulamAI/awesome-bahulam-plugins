/**
 * set_patent_metadata — set doc.patent.{type, priority_date, inventors}.
 * Only applies when doc.kind === "patent_application".
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';

const TYPES = new Set(['utility', 'provisional', 'design', 'plant']);

export async function call(args = {}, options = {}) {
  const { slug, type, priority_date, inventors, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = await loadOrCreate({ slug, cwd });
  if (doc.kind !== 'patent_application') {
    return { success: false, output: `Document kind is "${doc.kind}", not patent_application.` };
  }
  doc.patent = doc.patent || { type: 'utility', priority_date: null, inventors: [], claims_tree: [], prior_art: [] };
  if (type) {
    if (!TYPES.has(type)) return { success: false, output: `\`type\` must be one of: ${[...TYPES].join(', ')}` };
    doc.patent.type = type;
  }
  if (priority_date !== undefined) doc.patent.priority_date = priority_date || null;
  if (Array.isArray(inventors)) doc.patent.inventors = inventors;
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { patent: { type: doc.patent.type, priority_date: doc.patent.priority_date, inventor_count: doc.patent.inventors.length }, md_path: paths.md } };
}
