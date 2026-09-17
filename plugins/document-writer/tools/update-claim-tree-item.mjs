/**
 * update_claim_tree_item — narrow, broaden, or rewrite a patent claim's text.
 *
 * Args:
 *   slug*  - document slug
 *   id*    - claim id in claims_tree
 *   text*  - new claim text
 *   cwd
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, id, text, cwd } = args;
  if (!slug || !id || !text) return { success: false, output: '`slug`, `id`, `text` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  if (doc.kind !== 'patent_application' || !doc.patent) {
    return { success: false, output: `Document has no patent block.` };
  }
  const claim = doc.patent.claims_tree.find(c => c.id === id);
  if (!claim) return { success: false, output: `Claim "${id}" not found in claims_tree.` };
  const previous = claim.text;
  claim.text = text;
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id, previous_length: previous.length, new_length: text.length, md_path: paths.md } };
}
