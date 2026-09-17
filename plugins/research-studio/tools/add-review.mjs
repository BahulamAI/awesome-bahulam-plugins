/**
 * add_review — persist a review the Reviewer Agent authored via its
 * own gateway. Pure state.
 *
 * Args:
 *   slug*     - document slug
 *   persona   - "harsh_academic" | "industry_engineer" | "patent_examiner" | "custom"
 *   rubric    - "novelty" | "clarity" | "rigor" | "contribution" | "custom"
 *   verdict   - "accept" | "revise" | "reject"
 *   score     - optional 0-10
 *   comments  - freeform review text
 *   per_section - optional map { section_id -> comment }
 *   id
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { genId, nowIso } from './lib.mjs';

const VERDICTS = new Set(['accept', 'revise', 'reject']);

export async function call(args = {}, options = {}) {
  const { slug, persona, rubric, verdict, score, comments, per_section, id, cwd } = args;
  if (!slug || !verdict || !comments) return { success: false, output: '`slug`, `verdict`, `comments` required.' };
  if (!VERDICTS.has(verdict)) return { success: false, output: `\`verdict\` must be one of: ${[...VERDICTS].join(', ')}` };
  if (score != null && (Number(score) < 0 || Number(score) > 10)) {
    return { success: false, output: '`score` must be between 0 and 10.' };
  }

  const doc = await loadOrCreate({ slug, cwd });
  doc.reviews = doc.reviews || [];
  const reviewId = id || genId(doc.reviews.map(r => r.id), 'rev');
  const entry = {
    id: reviewId,
    verdict,
    ...(persona ? { persona } : {}),
    ...(rubric ? { rubric } : {}),
    ...(score != null ? { score: Number(score) } : {}),
    comments,
    ...(per_section && typeof per_section === 'object' ? { per_section } : {}),
    created_at: nowIso(),
  };
  doc.reviews.push(entry);
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id: reviewId, verdict, md_path: paths.md } };
}
