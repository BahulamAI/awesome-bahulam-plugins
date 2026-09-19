/**
 * Mistral OCR PDF provider — high-quality layout-aware extraction.
 *
 * Requires MISTRAL_API_KEY. Falls back to local if missing.
 * Endpoint may change — override with MISTRAL_OCR_ENDPOINT.
 */
import fs from 'node:fs';
import { ingest as localIngest } from './pdf-local.mjs';

const DEFAULT_ENDPOINT = 'https://api.mistral.ai/v1/ocr';

export async function ingest({ src, dstJson }) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) {
    const stub = await localIngest({ src, dstJson });
    return { ...stub, provider: 'local (MISTRAL_API_KEY missing)' };
  }
  const endpoint = process.env.MISTRAL_OCR_ENDPOINT || DEFAULT_ENDPOINT;
  const buf = fs.readFileSync(src);
  const b64 = buf.toString('base64');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: { type: 'document_base64', data: b64 } }),
  }).then(r => r.json());
  const text = res?.pages?.map(p => p.markdown || p.text || '').join('\n\n') || '';
  const result = {
    provider: 'mistral',
    bytes: buf.length,
    extracted_chars: text.length,
    text,
    pages: res?.pages?.length || 0,
    references_raw: [],
  };
  if (dstJson) fs.writeFileSync(dstJson, JSON.stringify(result, null, 2), 'utf-8');
  return result;
}
