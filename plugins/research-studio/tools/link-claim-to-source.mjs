/**
 * link_claim_to_source — add source ids (or reference ids) to a claim's
 * supported_by list. Does NOT verify the claim — verification is the
 * responsibility of the Vision Analyst / a human reviewer via
 * set_claim_verdict.
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, claim_id, source_ids, ref_ids, cwd } = args;
  if (!slug || !claim_id || (!Array.isArray(source_ids) && !Array.isArray(ref_ids))) {
    return { success: false, output: '`slug`, `claim_id`, and one of `source_ids[]`/`ref_ids[]` required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const claim = (doc.claims || []).find(c => c.id === claim_id);
  if (!claim) return { success: false, output: `Claim "${claim_id}" not found.` };

  const sources = new Set(Object.keys(doc.sources || {}));
  const refs = new Set(Object.keys(doc.references || {}));
  const toAdd = [...(source_ids || []), ...(ref_ids || [])];
  const missing = toAdd.filter(k => !sources.has(k) && !refs.has(k));
  if (missing.length) return { success: false, output: `Ids not found in sources or references: ${missing.join(', ')}` };

  claim.supported_by = [...new Set([...(claim.supported_by || []), ...toAdd])];
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { claim_id, supported_by: claim.supported_by, md_path: paths.md } };
}
