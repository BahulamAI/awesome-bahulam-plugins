/**
 * format_bibliography — set the document's bibliography style hint.
 *
 * refs.bib is always kept in sync by the compiler; this tool records
 * the preferred style so the LaTeX compiler picks the right
 * \\bibliographystyle{...}.
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

const STYLES = new Set(['ieee', 'acm', 'apa', 'arxiv', 'natbib']);

export async function call(args = {}, options = {}) {
  const { slug, style, cwd } = args;
  if (!slug || !style) return { success: false, output: '`slug` and `style` required.' };
  if (!STYLES.has(style)) return { success: false, output: `Style must be one of: ${[...STYLES].join(', ')}` };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  doc.meta = doc.meta || {};
  doc.meta.bib_style = style;
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { style, bib_path: paths.bib, md_path: paths.md } };
}
