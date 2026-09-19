/**
 * set_figure_description — persist a figure's description (from Vision Analyst).
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, figure_id, description, caption, cwd } = args;
  if (!slug || !figure_id || description == null) {
    return { success: false, output: '`slug`, `figure_id`, `description` required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const fig = (doc.figures || []).find(f => f.id === figure_id);
  if (!fig) return { success: false, output: `Figure "${figure_id}" not found.` };

  fig.description = description;
  if (caption) fig.caption = caption;

  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { figure_id, has_caption: !!fig.caption, md_path: paths.md } };
}
