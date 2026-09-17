/**
 * list_unsupported_claims — return claims where verified !== true OR
 * supported_by is empty. This is the honesty check the Director runs
 * before compiling a final target.
 */
import { loadDocument } from './lib.mjs';

export async function call(args = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const claims = doc.claims || [];
  const problems = claims
    .filter(c => c.verified !== true || !(c.supported_by || []).length)
    .map(c => ({
      id: c.id, text: c.text, section: c.section, kind: c.kind,
      supported_by: c.supported_by || [],
      verified: c.verified === true,
      reason: !(c.supported_by || []).length ? 'no source or ref linked'
            : c.verified !== true ? 'not yet verified'
            : 'unknown',
    }));
  return {
    success: true,
    output: {
      total_claims: claims.length,
      unsupported_count: problems.length,
      unsupported: problems,
    },
  };
}
