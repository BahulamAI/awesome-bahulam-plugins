/**
 * list_claims — return claims (optionally filtered by section / verified).
 */
import { loadDocument } from './lib.mjs';

export async function call(args = {}) {
  const { slug, section, verified, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  let claims = doc.claims || [];
  if (section) claims = claims.filter(c => c.section === section);
  if (verified === true) claims = claims.filter(c => c.verified === true);
  if (verified === false) claims = claims.filter(c => c.verified !== true);
  return {
    success: true,
    output: {
      count: claims.length,
      verified: claims.filter(c => c.verified === true).length,
      unverified: claims.filter(c => c.verified !== true).length,
      claims: claims.map(c => ({
        id: c.id, text: c.text, section: c.section, kind: c.kind,
        supported_by: c.supported_by || [],
        verified: c.verified === true,
        verdict: c.verification?.verdict || null,
      })),
    },
  };
}
