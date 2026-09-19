/**
 * add_prior_art — register a prior-art reference on a patent application.
 *
 * Prior-art entries link to a reference already in doc.references (add
 * via add_reference or lookup_doi first).
 *
 * Args:
 *   slug*      - document slug
 *   ref_id*    - reference id in doc.references
 *   relevance  - "background" | "similar" | "distinguishing" (default "background")
 *   note       - short explanation of relevance
 *   id
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { genId } from './lib.mjs';

const RELEVANCE = new Set(['background', 'similar', 'distinguishing']);

export async function call(args = {}, options = {}) {
  const { slug, ref_id, relevance = 'background', note, id, cwd } = args;
  if (!slug || !ref_id) return { success: false, output: '`slug` and `ref_id` required.' };
  if (!RELEVANCE.has(relevance)) return { success: false, output: `\`relevance\` must be one of: ${[...RELEVANCE].join(', ')}` };

  const doc = await loadOrCreate({ slug, cwd });
  if (doc.kind !== 'patent_application') return { success: false, output: `Document kind is "${doc.kind}", not patent_application.` };
  if (!doc.references?.[ref_id]) return { success: false, output: `Reference "${ref_id}" not found. Add via add_reference first.` };
  doc.patent = doc.patent || { type: 'utility', priority_date: null, inventors: [], claims_tree: [], prior_art: [] };

  const paId = id || genId(doc.patent.prior_art.map(p => p.id), 'pa');
  doc.patent.prior_art.push({ id: paId, ref_id, relevance, ...(note ? { note } : {}) });
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id: paId, ref_id, relevance, md_path: paths.md } };
}
