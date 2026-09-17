/**
 * add_experiment — register an experimental data file (CSV/JSON/other)
 * as a source. Copies the file into sources/ if it's outside the
 * document folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { docPaths } from './lib.mjs';

export async function call(args = {}, options = {}) {
  const { slug, path: srcPath, id, description, cwd } = args;
  if (!slug || !srcPath) return { success: false, output: '`slug` and `path` required.' };
  if (!fs.existsSync(srcPath)) return { success: false, output: `File not found: ${srcPath}` };

  const doc = await loadOrCreate({ slug, cwd });
  const paths = docPaths(slug, cwd);
  const filename = path.basename(srcPath);
  const dst = path.join(paths.sources, filename);
  if (path.resolve(srcPath) !== path.resolve(dst)) fs.copyFileSync(srcPath, dst);

  const sourceId = id || `expt_${filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_')}`;
  doc.sources = doc.sources || {};
  doc.sources[sourceId] = {
    kind: 'experiment',
    path: path.relative(paths.dir, dst),
    ...(description ? { description } : {}),
  };
  const out = await saveAndSync(doc, cwd, options);
  return { success: true, output: { source_id: sourceId, path: doc.sources[sourceId].path, md_path: out.md } };
}
