/**
 * add_claim_tree_item — append an independent or dependent claim to
 * doc.patent.claims_tree.
 *
 * Args:
 *   slug*       - document slug
 *   text*       - claim text (canonical patent claim prose)
 *   kind        - "independent" | "dependent" (default independent)
 *   depends_on  - required when kind === "dependent" — the claim id it depends on
 *   id          - stable id (auto: next integer as a string, patent convention)
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, text, kind = 'independent', depends_on, id, cwd } = args;
  if (!slug || !text) return { success: false, output: '`slug` and `text` required.' };
  if (!['independent', 'dependent'].includes(kind)) return { success: false, output: '`kind` must be independent or dependent.' };
  if (kind === 'dependent' && !depends_on) return { success: false, output: 'Dependent claims require `depends_on`.' };

  const doc = await loadOrCreate({ slug, cwd });
  if (doc.kind !== 'patent_application') return { success: false, output: `Document kind is "${doc.kind}", not patent_application.` };
  doc.patent = doc.patent || { type: 'utility', priority_date: null, inventors: [], claims_tree: [], prior_art: [] };

  if (kind === 'dependent') {
    const parent = doc.patent.claims_tree.find(c => c.id === depends_on);
    if (!parent) return { success: false, output: `\`depends_on\` claim "${depends_on}" not found.` };
  }

  const claimId = id || String(doc.patent.claims_tree.length + 1);
  if (doc.patent.claims_tree.some(c => c.id === claimId)) {
    return { success: false, output: `Claim id "${claimId}" already exists in claims_tree.` };
  }

  const entry = { id: claimId, text, kind };
  if (kind === 'dependent') entry.depends_on = depends_on;
  doc.patent.claims_tree.push(entry);

  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id: claimId, kind, depends_on: depends_on || null, md_path: paths.md } };
}
