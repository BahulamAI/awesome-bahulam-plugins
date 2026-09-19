/**
 * add_reference — register a reference entry (structured fields or raw BibTeX).
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';

const VALID_TYPES = new Set(['article', 'inproceedings', 'book', 'incollection', 'techreport', 'phdthesis', 'mastersthesis', 'misc', 'unpublished', 'patent']);

// Minimal BibTeX parser — good enough for well-formed entries the
// Cite Agent will realistically produce. NOT a full grammar.
function parseBibtex(bibtex) {
  const s = String(bibtex).trim();
  const head = s.match(/^@([a-z]+)\s*{\s*([^,]+)\s*,/i);
  if (!head) return null;
  const type = head[1].toLowerCase();
  const id = head[2].trim();
  const body = s.slice(head[0].length, s.lastIndexOf('}'));
  const fields = {};
  const re = /\s*([a-z]+)\s*=\s*[{"]([^{}"]*(?:\{[^}]*\}[^{}"]*)*)[}"]\s*,?/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const k = m[1].toLowerCase();
    fields[k === 'author' ? 'authors' : k] = k === 'author'
      ? m[2].split(/\s+and\s+/).map(a => a.trim())
      : m[2].trim();
  }
  return { id, type, fields };
}

export async function call(args = {}, options = {}) {
  const { slug, ref_id, type, fields, bibtex, cwd } = args;
  if (!slug || !ref_id) return { success: false, output: '`slug` and `ref_id` required.' };

  let entry;
  if (bibtex) {
    const parsed = parseBibtex(bibtex);
    if (!parsed) return { success: false, output: 'Could not parse `bibtex` string.' };
    entry = { type: parsed.type, fields: parsed.fields };
  } else {
    if (!type || !fields) return { success: false, output: 'Provide either `bibtex` or both `type` + `fields`.' };
    if (!VALID_TYPES.has(type)) return { success: false, output: `Invalid type "${type}". Use one of: ${[...VALID_TYPES].join(', ')}` };
    entry = { type, fields };
  }

  const doc = await loadOrCreate({ slug, cwd });
  doc.references = doc.references || {};
  const wasNew = !doc.references[ref_id];
  doc.references[ref_id] = entry;
  const paths = await saveAndSync(doc, cwd, options);
  return {
    success: true,
    output: {
      ref_id, is_new: wasNew, type: entry.type,
      md_path: paths.md, bib_path: paths.bib,
    },
  };
}
