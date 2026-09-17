/**
 * list_reviews — return all reviews on a document.
 */
import { loadDocument } from './lib.mjs';

export async function call(args = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const reviews = (doc.reviews || []).map(r => ({
    id: r.id,
    verdict: r.verdict,
    persona: r.persona || null,
    rubric: r.rubric || null,
    score: r.score ?? null,
    created_at: r.created_at,
    comment_chars: (r.comments || '').length,
    per_section_count: r.per_section ? Object.keys(r.per_section).length : 0,
  }));
  return { success: true, output: { count: reviews.length, reviews } };
}
