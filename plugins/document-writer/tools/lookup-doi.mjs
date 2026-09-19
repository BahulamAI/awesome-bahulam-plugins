/**
 * lookup_doi — resolve a DOI / arXiv id / free-text query into a
 * structured reference. By default, registers the result on the
 * document. Uses Crossref (or the configured ref provider) — pure
 * structured-data API, no LLM.
 */
import { loadOrCreate, saveAndSync } from './document-io.mjs';
import { chooseProvider, loadProvider } from './providers/index.mjs';

export async function call(args = {}, options = {}) {
  const { slug, query, register = true, ref_id, provider, cwd } = args;
  if (!slug || !query) return { success: false, output: '`slug` and `query` required.' };

  const providerName = chooseProvider('ref', provider);
  const impl = await loadProvider('ref', providerName);
  const result = await impl.lookup({ query });
  if (result.error && !result.entry) return { success: false, output: result };

  if (!register) return { success: true, output: result };

  const doc = await loadOrCreate({ slug, cwd });
  const id = ref_id || result.suggested_id || `ref_${Date.now().toString(36)}`;
  doc.references = doc.references || {};
  const wasNew = !doc.references[id];
  doc.references[id] = result.entry;
  const paths = await saveAndSync(doc, cwd, options);

  return {
    success: true,
    output: {
      ref_id: id, is_new: wasNew,
      provider: result.provider,
      source: result.source,
      entry_title: result.entry?.fields?.title,
      md_path: paths.md, bib_path: paths.bib,
    },
  };
}
