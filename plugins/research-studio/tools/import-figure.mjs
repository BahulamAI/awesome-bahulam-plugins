/**
 * import_figure — register an image / figure file as an available figure.
 *
 * Copies the file into figures/ if outside the document folder. Registers
 * in doc.figures[]. Does NOT place the figure in a section — the Figure
 * Agent calls place_figure to bind it to sections after review.
 *
 * Args:
 *   slug*     - document slug
 *   path*     - local absolute path OR relative-to-doc path OR https URL
 *   id        - figure id (default: filename stem)
 *   caption   - short caption (printed with figure)
 *   placement - LaTeX float placement: h | t | b | H  (default h)
 *   cwd
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { docPaths } from './lib.mjs';

const EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.tiff']);

export async function call(args = {}, options = {}) {
  const { slug, path: srcPath, id, caption, placement = 'h', cwd } = args;
  if (!slug || !srcPath) return { success: false, output: '`slug` and `path` required.' };

  const paths = docPaths(slug, cwd);
  const doc = await loadOrCreate({ slug, cwd });

  let localSrc;
  if (/^https?:\/\//i.test(srcPath)) {
    const filename = path.basename(new URL(srcPath).pathname) || `download_${Date.now()}.png`;
    const dst = path.join(paths.figures, filename);
    try {
      const buf = Buffer.from(await (await fetch(srcPath)).arrayBuffer());
      fs.writeFileSync(dst, buf);
    } catch (e) {
      return { success: false, output: `Download failed: ${e.message}` };
    }
    localSrc = dst;
  } else if (path.isAbsolute(srcPath)) {
    if (!fs.existsSync(srcPath)) return { success: false, output: `File not found: ${srcPath}` };
    const dst = path.join(paths.figures, path.basename(srcPath));
    if (path.resolve(srcPath) !== path.resolve(dst)) fs.copyFileSync(srcPath, dst);
    localSrc = dst;
  } else {
    const abs = path.join(paths.dir, srcPath);
    if (!fs.existsSync(abs)) return { success: false, output: `Relative path not found: ${abs}` };
    localSrc = abs;
  }

  const ext = path.extname(localSrc).toLowerCase();
  if (!EXTS.has(ext)) {
    return { success: false, output: `Unsupported figure extension "${ext}". Use one of: ${[...EXTS].join(', ')}` };
  }

  const figId = id || path.basename(localSrc).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_');
  const relPath = path.relative(paths.dir, localSrc);
  doc.figures = doc.figures || [];
  const existing = doc.figures.findIndex(f => f.id === figId);
  const entry = { id: figId, path: relPath, ...(caption ? { caption } : {}), placement, referenced_in: existing >= 0 ? (doc.figures[existing].referenced_in || []) : [] };
  if (existing >= 0) doc.figures[existing] = { ...doc.figures[existing], ...entry };
  else doc.figures.push(entry);

  const out = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id: figId, path: relPath, replaced: existing >= 0, md_path: out.md } };
}
