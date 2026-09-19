/**
 * add_claim — register a verifiable assertion made in the document.
 *
 * The Claim Agent (its own gateway) reads the drafted prose, decides
 * what constitutes a claim, and calls this to record it. Claims are
 * initially unverified — Vision Analyst (or a manual set_claim_verdict)
 * flips `verified: true` later.
 *
 * Args:
 *   slug*         - document slug
 *   text*         - claim text as it appears in the section
 *   section*      - outline section id where the claim lives
 *   id            - stable claim id (auto-generated if omitted)
 *   kind          - "quantitative" | "complexity" | "qualitative" | "novelty" (default qualitative)
 *   supported_by  - array of source ids or ref ids
 *   value / unit  - optional numeric value + unit (for quantitative claims)
 *   cwd
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { genId } from './lib.mjs';

const VALID_KINDS = new Set(['quantitative', 'complexity', 'qualitative', 'novelty']);

export async function call(args = {}, options = {}) {
  const { slug, text, section, id, kind = 'qualitative', supported_by, value, unit, cwd } = args;
  if (!slug || !text || !section) return { success: false, output: '`slug`, `text`, `section` required.' };
  if (!VALID_KINDS.has(kind)) return { success: false, output: `\`kind\` must be one of: ${[...VALID_KINDS].join(', ')}` };

  const doc = await loadOrCreate({ slug, cwd });
  if (!(doc.outline || []).some(s => s.id === section)) {
    return { success: false, output: `Section "${section}" not in outline.` };
  }
  doc.claims = doc.claims || [];
  const claimId = id || genId(doc.claims.map(c => c.id), 'c');
  if (doc.claims.some(c => c.id === claimId)) return { success: false, output: `Claim id "${claimId}" already exists.` };
  const entry = {
    id: claimId, text, section, kind,
    supported_by: Array.isArray(supported_by) ? supported_by : [],
    verified: false,
  };
  if (value != null) entry.value = Number(value);
  if (unit) entry.unit = String(unit);
  doc.claims.push(entry);

  // Also record on the section for locality
  doc.sections = doc.sections || {};
  doc.sections[section] = doc.sections[section] || {};
  const cs = new Set(doc.sections[section].claims || []);
  cs.add(claimId);
  doc.sections[section].claims = [...cs];

  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { id: claimId, section, kind, unverified: true, md_path: paths.md } };
}
