/**
 * Crossref reference provider — DOI + free-text lookup.
 *
 * Free API, no key required. Polite-pool convention: set
 * RESEARCH_CROSSREF_EMAIL for higher rate limits.
 *
 * Falls back to local (regex only, no network) if RESEARCH_OFFLINE=1
 * or if the fetch fails.
 */
import { lookup as localLookup } from './ref-local.mjs';

const API = 'https://api.crossref.org/works';

function toBibEntry(item) {
  const authors = (item.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean);
  const year = item.issued?.['date-parts']?.[0]?.[0];
  const type = item.type === 'proceedings-article' ? 'inproceedings'
             : item.type === 'journal-article' ? 'article'
             : item.type === 'book' ? 'book'
             : item.type === 'book-chapter' ? 'incollection'
             : 'misc';
  return {
    type,
    fields: {
      authors,
      title: (item.title || [])[0] || '',
      year,
      doi: item.DOI,
      url: item.URL,
      booktitle: (item['container-title'] || [])[0] || '',
      journal:   (item['container-title'] || [])[0] || '',
      publisher: item.publisher || '',
      volume: item.volume,
      pages: item.page,
    },
  };
}

function suggestId(entry) {
  const firstAuthor = String(entry.fields.authors?.[0] || '').split(/\s+/).slice(-1)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${firstAuthor || 'ref'}${entry.fields.year || ''}`;
}

export async function lookup({ query }) {
  if (process.env.RESEARCH_OFFLINE === '1') return localLookup({ query });
  const email = process.env.RESEARCH_CROSSREF_EMAIL;
  const headers = { 'User-Agent': `research-studio/0.1 (mailto:${email || 'noreply@bahulam.ai'})` };
  // DOI direct
  const doiMatch = String(query).match(/10\.\d{4,9}\/\S+/);
  if (doiMatch) {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(doiMatch[0])}`, { headers }).then(r => r.json());
      if (res?.message) {
        const entry = toBibEntry(res.message);
        return { provider: 'crossref', suggested_id: suggestId(entry), entry, source: 'doi' };
      }
    } catch { /* fall through */ }
  }
  // free-text
  try {
    const res = await fetch(`${API}?query=${encodeURIComponent(query)}&rows=1`, { headers }).then(r => r.json());
    const item = res?.message?.items?.[0];
    if (!item) return { provider: 'crossref', error: 'no results', query };
    const entry = toBibEntry(item);
    return { provider: 'crossref', suggested_id: suggestId(entry), entry, source: 'search' };
  } catch (e) {
    return localLookup({ query });
  }
}
