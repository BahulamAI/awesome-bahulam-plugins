/**
 * ingest_url — snapshot a URL to sources/<id>.md.
 *
 * v0.1: fetches the HTML, strips tags, keeps text. A real Readability
 * cleanup would use `@mozilla/readability` — deferred to Phase 2.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { docPaths } from './lib.mjs';

function stripHtmlToText(html) {
  const noScripts = String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const noTags = noScripts.replace(/<[^>]+>/g, ' ');
  const decoded = noTags
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, ' ').trim();
}

export async function call(args = {}, options = {}) {
  const { slug, url, id, ref_id, cwd, title } = args;
  if (!slug || !url) return { success: false, output: '`slug` and `url` required.' };

  const doc = await loadOrCreate({ slug, title, cwd });
  const paths = docPaths(slug, cwd);

  const sourceId = id || `url_${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
  const dst = path.join(paths.sources, `${sourceId}.md`);
  let text = '';
  try {
    const res = await fetch(url);
    const html = await res.text();
    text = stripHtmlToText(html);
  } catch (e) {
    return { success: false, output: `Fetch failed: ${e.message}` };
  }

  fs.writeFileSync(dst, `# Snapshot: ${url}\n\n${text}\n`, 'utf-8');

  doc.sources = doc.sources || {};
  doc.sources[sourceId] = {
    kind: 'url',
    url,
    path: path.relative(paths.dir, dst),
    extracted_chars: text.length,
    ...(ref_id ? { ref_id } : {}),
  };

  const out = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      source_id: sourceId,
      url,
      path: doc.sources[sourceId].path,
      extracted_chars: text.length,
      md_path: out.md,
    },
  };
}
