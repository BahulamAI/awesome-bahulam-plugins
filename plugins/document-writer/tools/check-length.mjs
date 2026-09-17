/**
 * check_length — return per-section word count vs target, plus totals.
 * Pure query.
 */
import { loadDocument, wordCount, documentWordCount } from './lib.mjs';

export async function call(args = {}) {
  const { slug, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const per = (doc.outline || []).map(s => {
    const content = doc.sections?.[s.id]?.content || '';
    const actual = wordCount(content);
    const target = s.target_words || 0;
    const ratio = target ? actual / target : null;
    const status = !target ? 'unset'
                 : ratio < 0.5 ? 'under'
                 : ratio > 1.5 ? 'over'
                 : 'ok';
    return { id: s.id, heading: s.heading, target, actual, ratio, status };
  });
  const total = documentWordCount(doc);
  const targetTotal = per.reduce((n, r) => n + (r.target || 0), 0);
  return {
    success: true,
    output: {
      per_section: per,
      total_actual: total,
      total_target: targetTotal,
      overall_status: !targetTotal ? 'unset' : total / targetTotal < 0.5 ? 'under' : total / targetTotal > 1.3 ? 'over' : 'ok',
    },
  };
}
