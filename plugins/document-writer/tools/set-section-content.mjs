/**
 * set_section_content — persist prose the agent has authored.
 *
 * The Draft Agent uses its own gateway to write the section text and
 * then calls this tool to store it. Supports append or replace.
 * Also parses [ref_id] citations in the content and records them on
 * doc.sections[section_id].cites (as long as ref_id exists in
 * doc.references).
 */
import { loadDocument, wordCount } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

const CITE_RE = /\[([a-zA-Z0-9_-]{1,64})\]/g;

export async function call(args = {}, options = {}) {
  const { slug, section_id, content, mode = 'replace', cwd } = args;
  if (!slug || !section_id || content == null) {
    return { success: false, output: '`slug`, `section_id`, `content` required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  if (!(doc.outline || []).some(s => s.id === section_id)) {
    return { success: false, output: `Section "${section_id}" not in outline. Call add_section or set_outline first.` };
  }

  doc.sections = doc.sections || {};
  const existing = doc.sections[section_id]?.content || '';
  const nextContent = mode === 'append' ? `${existing}${existing ? '\n\n' : ''}${content}` : content;

  // Extract citations that resolve to known references
  const refs = new Set(Object.keys(doc.references || {}));
  const cites = [];
  const seen = new Set();
  let m;
  while ((m = CITE_RE.exec(nextContent)) !== null) {
    if (refs.has(m[1]) && !seen.has(m[1])) { cites.push(m[1]); seen.add(m[1]); }
  }

  doc.sections[section_id] = {
    ...(doc.sections[section_id] || {}),
    content: nextContent,
    cites,
  };

  const paths = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      section_id,
      word_count: wordCount(nextContent),
      cites,
      unresolved_cite_candidates: extractUnresolvedCites(nextContent, refs),
      md_path: paths.md,
    },
  };
}

function extractUnresolvedCites(text, refs) {
  const out = [];
  const seen = new Set();
  CITE_RE.lastIndex = 0;
  let m;
  while ((m = CITE_RE.exec(text)) !== null) {
    if (!refs.has(m[1]) && !seen.has(m[1])) { out.push(m[1]); seen.add(m[1]); }
  }
  return out;
}
