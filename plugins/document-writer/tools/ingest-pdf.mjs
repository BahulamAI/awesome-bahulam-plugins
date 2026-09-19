/**
 * ingest_pdf — ingest a PDF (local path or URL) as a source.
 *
 * Copies/downloads the PDF into sources/, extracts text via configured
 * pdf provider, writes sources/extracted/<id>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { docPaths } from './lib.mjs';
import { chooseProvider, loadProvider } from './providers/index.mjs';

export async function call(args = {}, options = {}) {
  const { slug, src, id, ref_id, provider, cwd, title } = args;
  if (!slug || !src) return { success: false, output: '`slug` and `src` required.' };

  const doc = await loadOrCreate({ slug, title, cwd });
  const paths = docPaths(slug, cwd);

  // Resolve source into sources/
  let localSrc = src;
  if (/^https?:\/\//i.test(src)) {
    const filename = path.basename(new URL(src).pathname) || `download_${Date.now()}.pdf`;
    const dst = path.join(paths.sources, filename);
    try {
      const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
      fs.writeFileSync(dst, buf);
    } catch (e) {
      return { success: false, output: `Download failed: ${e.message}` };
    }
    localSrc = dst;
  } else if (path.isAbsolute(src)) {
    if (!fs.existsSync(src)) return { success: false, output: `File not found: ${src}` };
    const dst = path.join(paths.sources, path.basename(src));
    if (path.resolve(src) !== path.resolve(dst)) fs.copyFileSync(src, dst);
    localSrc = dst;
  } else {
    // Relative path — assume already under scene
    const abs = path.join(paths.dir, src);
    if (!fs.existsSync(abs)) return { success: false, output: `File not found: ${abs}` };
    localSrc = abs;
  }

  const sourceId = id || path.basename(localSrc).replace(/\.[^.]+$/, '');
  const extractedJson = path.join(paths.extracted, `${sourceId}.json`);

  const providerName = chooseProvider('pdf', provider);
  const impl = await loadProvider('pdf', providerName);
  const result = await impl.ingest({ src: localSrc, dstJson: extractedJson });
  if (result.error) return { success: false, output: result };

  doc.sources = doc.sources || {};
  doc.sources[sourceId] = {
    kind: 'pdf',
    path: path.relative(paths.dir, localSrc),
    extracted_path: path.relative(paths.dir, extractedJson),
    provider: result.provider,
    extracted_chars: result.extracted_chars,
    ...(ref_id ? { ref_id } : {}),
  };

  const out = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      source_id: sourceId,
      path: doc.sources[sourceId].path,
      extracted_path: doc.sources[sourceId].extracted_path,
      provider: result.provider,
      extracted_chars: result.extracted_chars,
      note: result.note,
      md_path: out.md,
    },
  };
}
