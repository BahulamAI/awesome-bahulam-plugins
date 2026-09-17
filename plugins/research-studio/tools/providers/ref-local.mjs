/**
 * Local reference "lookup" — offline regex only.
 *
 * Recognizes DOIs and arXiv ids in the query and constructs a
 * placeholder entry so downstream tools have something to attach.
 * Real metadata resolution requires a network provider.
 */

export async function lookup({ query }) {
  const q = String(query || '').trim();
  const doi = q.match(/10\.\d{4,9}\/\S+/)?.[0];
  const arxiv = q.match(/arxiv[:/]?(\d{4}\.\d{4,5})/i)?.[1];
  if (doi) {
    return {
      provider: 'local',
      suggested_id: `ref_${doi.replace(/[^a-z0-9]/gi, '_').slice(-16)}`,
      entry: { type: 'misc', fields: { doi, title: `[Unresolved DOI — configure RESEARCH_REF_PROVIDER=crossref for metadata]`, url: `https://doi.org/${doi}` } },
      source: 'local-doi',
    };
  }
  if (arxiv) {
    return {
      provider: 'local',
      suggested_id: `arxiv_${arxiv.replace('.', '_')}`,
      entry: { type: 'misc', fields: { title: `[Unresolved arXiv ${arxiv}]`, url: `https://arxiv.org/abs/${arxiv}` } },
      source: 'local-arxiv',
    };
  }
  return {
    provider: 'local',
    error: 'local ref provider cannot resolve free-text queries — configure RESEARCH_REF_PROVIDER=crossref (no API key required)',
    query: q,
  };
}
