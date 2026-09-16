/**
 * Local PDF provider — zero-dep text extraction.
 *
 * Uses a minimal PDF text scan (strings between BT/ET operators) to
 * pull whatever text is uncompressed. Real papers use compressed
 * streams and this misses most content — but it correctly reports
 * what it extracted and how much, so agents can decide whether to
 * upgrade to a real provider.
 *
 * Real extraction requires `mistral` (or `unstructured`, `llamaparse`)
 * — set RESEARCH_PDF_PROVIDER=mistral + MISTRAL_API_KEY.
 */
import fs from 'node:fs';

function extractSimpleText(buf) {
  // Scan for text between "BT" and "ET" markers, capture strings in ( ... ) Tj
  const s = buf.toString('binary');
  const lines = [];
  const regex = /BT\s+([\s\S]*?)\s+ET/g;
  let m;
  while ((m = regex.exec(s)) !== null) {
    const block = m[1];
    const inner = block.match(/\(([^)]*)\)\s*Tj/g) || [];
    for (const cap of inner) {
      const text = cap.replace(/^\(/, '').replace(/\)\s*Tj$/, '')
        .replace(/\\n/g, '\n').replace(/\\r/g, '')
        .replace(/\\([()\\])/g, '$1');
      if (text.trim()) lines.push(text);
    }
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

// Very heuristic references extractor — find lines that look like citations
function extractReferencesHeuristic(text) {
  if (!text) return [];
  const refs = [];
  const re = /([A-Z][a-z]+(?:,?\s*(?:[A-Z]\.\s*)+)+\s*[^.]{5,80}\s*\(\s*(\d{4})\s*\))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    refs.push({ raw: m[1].slice(0, 220), year: m[2] });
    if (refs.length >= 40) break;
  }
  return refs;
}

export async function ingest({ src, dstJson }) {
  if (!fs.existsSync(src)) return { provider: 'local', error: `file not found: ${src}` };
  const buf = fs.readFileSync(src);
  const text = extractSimpleText(buf);
  const refs = extractReferencesHeuristic(text);
  const result = {
    provider: 'local',
    bytes: buf.length,
    extracted_chars: text.length,
    text,
    references_raw: refs,
    note: text.length < 200
      ? 'local PDF provider extracted very little text (likely compressed streams). Configure RESEARCH_PDF_PROVIDER=mistral (+MISTRAL_API_KEY) for real extraction.'
      : 'local PDF provider — text may be partial. Use mistral for full fidelity.',
  };
  if (dstJson) fs.writeFileSync(dstJson, JSON.stringify(result, null, 2), 'utf-8');
  return result;
}
