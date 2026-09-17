/**
 * extract_figures_from_pdf — pull figure images from an ingested PDF.
 *
 * v0.1: relies on the PDF provider's structured output. The local
 * provider only extracts text and therefore reports 0 figures — this
 * is expected and surfaced in the note. Real figure extraction
 * requires RESEARCH_PDF_PROVIDER=mistral (or similar).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDocument, docPaths } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, source_id, cwd } = args;
  if (!slug || !source_id) return { success: false, output: '`slug` and `source_id` required.' };
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  const src = doc.sources?.[source_id];
  if (!src) return { success: false, output: `Source "${source_id}" not found.` };
  if (src.kind !== 'pdf') return { success: false, output: `Source "${source_id}" is kind "${src.kind}", not pdf.` };

  const paths = docPaths(slug, cwd);
  const extractedJson = path.join(paths.dir, src.extracted_path || `sources/extracted/${source_id}.json`);
  if (!fs.existsSync(extractedJson)) {
    return { success: false, output: `Extracted JSON not found: ${extractedJson}. Re-run ingest_pdf.` };
  }
  const extracted = JSON.parse(fs.readFileSync(extractedJson, 'utf-8'));

  // Provider-supplied figures (Mistral OCR emits page images / cropped figures)
  const figures = extracted.figures || [];
  const outDir = path.join(paths.extracted, source_id, 'figures');
  fs.mkdirSync(outDir, { recursive: true });

  const added = [];
  figures.forEach((f, idx) => {
    // Provider may supply base64 or a relative path already inside sources/
    let outPath = null;
    if (f.data_base64) {
      outPath = path.join(outDir, f.filename || `fig_${idx}.png`);
      fs.writeFileSync(outPath, Buffer.from(f.data_base64, 'base64'));
    } else if (f.path && fs.existsSync(f.path)) {
      outPath = path.join(outDir, path.basename(f.path));
      fs.copyFileSync(f.path, outPath);
    }
    if (outPath) {
      const figId = `${source_id}_fig_${idx + 1}`;
      const relPath = path.relative(paths.dir, outPath);
      doc.figures = doc.figures || [];
      if (!doc.figures.some(x => x.id === figId)) {
        doc.figures.push({
          id: figId,
          path: relPath,
          caption: f.caption || '',
          source_id,
          placement: 'h',
          referenced_in: [],
        });
      }
      added.push({ id: figId, path: relPath });
    }
  });

  const out = await saveAndSync(doc, cwd, options);

  const note = added.length === 0
    ? `0 figures extracted — the PDF provider "${extracted.provider}" did not emit figure images. Configure RESEARCH_PDF_PROVIDER=mistral (+MISTRAL_API_KEY) for real figure extraction.`
    : `${added.length} figure(s) extracted into ${path.relative(paths.dir, outDir)}/.`;

  return { success: true, output: { source_id, added, note, md_path: out.md } };
}
