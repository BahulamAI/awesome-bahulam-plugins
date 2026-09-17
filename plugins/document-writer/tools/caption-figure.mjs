/**
 * caption_figure — set the short caption of a figure (printed alongside).
 *
 * The longer `description` field is set separately via
 * set_figure_description (Vision Analyst's tool from Phase 1).
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, figure_id, caption, placement, cwd } = args;
  if (!slug || !figure_id || (caption == null && !placement)) {
    return { success: false, output: '`slug`, `figure_id`, and one of `caption`/`placement` required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const fig = (doc.figures || []).find(f => f.id === figure_id);
  if (!fig) return { success: false, output: `Figure "${figure_id}" not found.` };
  if (caption != null) fig.caption = caption;
  if (placement) {
    if (!['h', 't', 'b', 'H'].includes(placement)) return { success: false, output: `\`placement\` must be h|t|b|H` };
    fig.placement = placement;
  }
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { figure_id, caption: fig.caption || '', placement: fig.placement, md_path: paths.md } };
}
