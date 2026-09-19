/**
 * attach_citation — record cite relationships on a section (in the DSL).
 *
 * Does NOT insert citation text into prose — that's the Draft Agent's
 * job (via set_section_content). This just marks intent so the Draft
 * Agent knows which refs are available and the compiler can show
 * per-section cite hints.
 */
import { loadDocument } from './lib.mjs';
import { saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, section_id, ref_ids, cwd } = args;
  if (!slug || !section_id || !Array.isArray(ref_ids) || !ref_ids.length) {
    return { success: false, output: '`slug`, `section_id`, `ref_ids[]` required.' };
  }
  const doc = loadDocument(slug, cwd);
  if (!doc) return { success: false, output: `Document "${slug}" not found.` };
  if (!(doc.outline || []).some(s => s.id === section_id)) {
    return { success: false, output: `Section "${section_id}" not in outline.` };
  }
  const refs = new Set(Object.keys(doc.references || {}));
  const missing = ref_ids.filter(r => !refs.has(r));
  if (missing.length) return { success: false, output: `References not found: ${missing.join(', ')}` };

  doc.sections = doc.sections || {};
  const cur = new Set(doc.sections[section_id]?.cites || []);
  ref_ids.forEach(r => cur.add(r));
  doc.sections[section_id] = { ...(doc.sections[section_id] || {}), cites: [...cur] };
  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { section_id, cites: [...cur], md_path: paths.md } };
}
