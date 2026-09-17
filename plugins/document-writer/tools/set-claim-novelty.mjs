/**
 * set_claim_novelty — persist a novelty verdict on a patent claim.
 *
 * The Prior-Art Agent uses its own gateway to compare the claim text
 * against prior-art references, then calls this to record the verdict.
 *
 * Args:
 *   slug*            - document slug
 *   claim_id*        - id in patent.claims_tree
 *   verdict*         - "novel" | "similar_to_prior" | "anticipated" | "inconclusive"
 *   prior_art_refs   - array of prior-art ids that informed the verdict
 *   reason           - freeform explanation
 *   cwd
 */
import { loadDocument, nowIso } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

const VERDICTS = new Set(['novel', 'similar_to_prior', 'anticipated', 'inconclusive']);

export async function call(args = {}, options = {}) {
  const { slug, claim_id, verdict, prior_art_refs, reason, cwd } = args;
  if (!slug || !claim_id || !verdict) return { success: false, output: '`slug`, `claim_id`, `verdict` required.' };
  if (!VERDICTS.has(verdict)) return { success: false, output: `\`verdict\` must be one of: ${[...VERDICTS].join(', ')}` };

  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  if (doc.kind !== 'patent_application' || !doc.patent) return { success: false, output: `Document has no patent block.` };
  const claim = doc.patent.claims_tree.find(c => c.id === claim_id);
  if (!claim) return { success: false, output: `Claim "${claim_id}" not in claims_tree.` };

  claim.novelty = {
    verdict,
    ...(Array.isArray(prior_art_refs) ? { prior_art_refs } : {}),
    ...(reason ? { reason } : {}),
    at: nowIso(),
  };
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { claim_id, verdict, md_path: paths.md } };
}
