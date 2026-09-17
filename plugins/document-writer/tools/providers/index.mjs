/**
 * Provider adapter dispatcher for document-writer.
 *
 * Only structured-data providers live here (PDF extraction, reference
 * metadata lookup). LLM-driven work — drafting prose, describing
 * figures, verifying claims against images — is the agent's job:
 * each agent declares its own gateway (text or vision-capable) in
 * its YAML, generates content via that gateway, and calls a pure
 * state-mutation tool (set_section_content / set_figure_description /
 * set_claim_verdict) to persist the result.
 *
 * Env selection:
 *   RESEARCH_PDF_PROVIDER : mistral | local          (default: local)
 *   RESEARCH_REF_PROVIDER : crossref | local         (default: crossref;
 *                                                     RESEARCH_OFFLINE=1 forces local)
 */

export function chooseProvider(kind, override) {
  if (override) return String(override);
  const envKey = { pdf: 'RESEARCH_PDF_PROVIDER', ref: 'RESEARCH_REF_PROVIDER' }[kind];
  const defaults = { pdf: 'local', ref: 'crossref' };
  return process.env[envKey] || defaults[kind];
}

export async function loadProvider(kind, name) {
  const registry = {
    pdf: {
      local:   () => import('./pdf-local.mjs'),
      mistral: () => import('./pdf-mistral.mjs'),
    },
    ref: {
      local:    () => import('./ref-local.mjs'),
      crossref: () => import('./ref-crossref.mjs'),
    },
  };
  const loader = registry[kind]?.[name] || registry[kind]?.[Object.keys(registry[kind])[0]];
  try { return await loader(); }
  catch { return registry[kind][Object.keys(registry[kind])[0]](); }
}
