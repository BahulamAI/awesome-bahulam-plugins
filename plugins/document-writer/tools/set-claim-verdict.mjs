/**
 * set_claim_verdict — persist a vision-verification verdict on a claim.
 *
 * Verified=true is stamped when verdict === "supported".
 */
import { loadDocument, nowIso } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

const VERDICTS = new Set(['supported', 'contradicted', 'inconclusive']);

export async function call(args = {}, options = {}) {
  const { slug, claim_id, verdict, figure_ref, confidence, reason, cwd } = args;
  if (!slug || !claim_id || !verdict) return { success: false, output: '`slug`, `claim_id`, `verdict` required.' };
  if (!VERDICTS.has(verdict)) return { success: false, output: `\`verdict\` must be one of: ${[...VERDICTS].join(', ')}` };

  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const claim = (doc.claims || []).find(c => c.id === claim_id);
  if (!claim) return { success: false, output: `Claim "${claim_id}" not found.` };

  claim.verification = {
    verdict,
    ...(figure_ref ? { figure_ref } : {}),
    ...(confidence != null ? { confidence: Number(confidence) } : {}),
    ...(reason ? { reason } : {}),
    at: nowIso(),
  };
  claim.verified = verdict === 'supported';

  const paths = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: { claim_id, verdict, verified: claim.verified, md_path: paths.md },
  };
}
