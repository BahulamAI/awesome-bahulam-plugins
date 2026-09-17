/**
 * set_watermark — set (or clear) the document's watermark.
 *
 * Watermark is a doc.meta.watermark object rendered by every compile
 * target. It is FORMATTING intent, not content — the compiler adds it
 * to md / tex / pdf / docx / uspto_xml at emission time; it does not
 * appear in the DSL body.
 *
 * Args:
 *   slug*      - document slug
 *   text       - watermark string (e.g. "DRAFT", "CONFIDENTIAL",
 *                "WORKING DRAFT v3"). Pass null or empty string to CLEAR
 *                the watermark AND opt out of auto-DRAFT (see below).
 *   opacity    - 0-1, default 0.15
 *   angle      - rotation in degrees (LaTeX/PDF only), default 45
 *   color      - CSS color, default "#888888"
 *   cwd
 *
 * Three states the compiler distinguishes:
 *   1. meta.watermark absent (never called set_watermark):
 *      → compiler applies AUTO-DRAFT when list_unsupported_claims > 0.
 *   2. meta.watermark === null (explicitly cleared):
 *      → compiler emits NOTHING, even with unverified claims. User's call.
 *   3. meta.watermark: { text, ... }:
 *      → compiler emits exactly what was set.
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';

export async function call(args = {}, options = {}) {
  const { slug, text, opacity, angle, color, cwd } = args;
  if (!slug) return { success: false, output: '`slug` required.' };

  const doc = await loadOrCreate({ slug, cwd });
  doc.meta = doc.meta || {};

  const clearing = text === null || (typeof text === 'string' && text.trim() === '');
  if (clearing) {
    // Explicit opt-out: null (not undefined) so the compiler's auto-DRAFT
    // path can distinguish "user cleared" from "user hasn't decided".
    doc.meta.watermark = null;
    const paths = await saveAndSync(doc, cwd, options);
    return { success: true, output: { watermark: null, md_path: paths.md } };
  }

  if (typeof text !== 'string' || !text.trim()) {
    return { success: false, output: '`text` must be a non-empty string, null, or "" to clear.' };
  }
  if (opacity != null && (Number(opacity) < 0 || Number(opacity) > 1)) {
    return { success: false, output: '`opacity` must be between 0 and 1.' };
  }

  const watermark = {
    text: text.trim(),
    opacity: opacity != null ? Number(opacity) : 0.15,
    angle: angle != null ? Number(angle) : 45,
    color: color ? String(color) : '#888888',
  };
  doc.meta.watermark = watermark;

  const paths = await saveAndSync(doc, cwd, options);
  return { success: true, output: { watermark, md_path: paths.md } };
}
