import { createHash } from 'node:crypto';

export const hash = text => createHash('sha256').update(text).digest('hex');
export const normalize = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
export function text(value, label, max = 10000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is required (maximum ${max} characters)`);
  return value.trim();
}
export function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function number(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${min}–${max}${integer ? ' (whole number)' : ''}`);
  return value;
}
export function canonicalUrl(input) {
  const u = new URL(text(input, 'Source URL', 4000));
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Use a public HTTP(S) source URL without credentials');
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  return u.toString();
}
export function appConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('App configuration is required');
  const a = Object.fromEntries(['name', 'brief', 'audiences', 'hypotheses', 'language', 'country', 'criteria'].filter(k => input[k] !== undefined).map(k => [k, structuredClone(input[k])]));
  a.name = text(a.name, 'App name', 120);
  a.brief = text(a.brief, 'Brief', 8000);
  if (!Array.isArray(a.audiences) || !a.audiences.length || a.audiences.length > 10) throw new Error('Define 1–10 audiences');
  a.audiences = a.audiences.map(x => text(x, 'Audience', 200));
  if (new Set(a.audiences).size !== a.audiences.length) throw new Error('Audiences must be unique');
  if (!Array.isArray(a.hypotheses) || !a.hypotheses.length || a.hypotheses.length > 10) throw new Error('Define 1–10 hypotheses');
  a.hypotheses = a.hypotheses.map(h => ({ id: text(h.id, 'Hypothesis ID', 40), statement: text(h.statement, 'Hypothesis', 2000) }));
  if (new Set(a.hypotheses.map(h => h.id)).size !== a.hypotheses.length) throw new Error('Hypothesis IDs must be unique');
  a.language = text(a.language || 'en', 'Language', 10);
  a.country = text(a.country || 'US', 'Country', 2).toUpperCase();
  a.criteria = a.criteria || { direct: 10, contexts: 3, families: 2, consequences: 5, months: 24 };
  for (const k of ['direct', 'contexts', 'families', 'consequences', 'months']) number(a.criteria[k], k, 1, 1000, true);
  return a;
}
export function runConfig(input, app) {
  const inputBudgets = input.budgets || {};
  if ('search_usd' in inputBudgets || 'search_request_usd' in inputBudgets) {
    throw new Error('Search spend is not estimated here. Set a search-call cap and check billed usage in your Brave dashboard.');
  }
  const b = { queries: inputBudgets.queries, documents: inputBudgets.documents, minutes: inputBudgets.minutes };
  number(b.queries, 'Query cap', 1, 100, true);
  number(b.documents, 'Document cap', 1, 500, true);
  number(b.minutes, 'Collection time cap', 1, 240, true);
  if (!Array.isArray(input.queries) || !input.queries.length || input.queries.length > b.queries) throw new Error('Query plan must contain 1 to query-cap entries');
  const seen = new Set();
  const queries = input.queries.map(q => {
    const query = text(q.query, 'Query', 500);
    if (seen.has(query)) throw new Error('Remove duplicate queries');
    seen.add(query);
    return { query, audience: choice(q.audience, app.audiences, 'audience'), intent: choice(q.intent, ['pain', 'alternatives', 'contrary'], 'search intent'), status: 'pending', attempts: 0 };
  });
  for (const audience of app.audiences) for (const intent of ['pain', 'alternatives', 'contrary']) {
    if (!queries.some(q => q.audience === audience && q.intent === intent)) throw new Error(`Missing ${intent} search for ${audience}`);
  }
  return { budgets: b, queries };
}
export function evidenceFields(input, app) {
  return {
    quote: text(input.quote, 'Exact quote', 5000),
    audience: choice(input.audience, app.audiences, 'audience'),
    hypothesis_ids: (input.hypothesis_ids || []).map(h => choice(h, app.hypotheses.map(x => x.id), 'hypothesis')),
    relevance: choice(input.relevance, ['direct', 'adjacent', 'irrelevant'], 'relevance'),
    direction: choice(input.direction, ['supports', 'contradicts', 'mixed/unclear'], 'direction'),
    unprompted: choice(input.unprompted || 'unknown', ['yes', 'no', 'unknown'], 'unprompted status'),
    rationale: text(input.rationale, 'Rationale', 3000),
    consequence: String(input.consequence || '').slice(0, 3000),
    workaround: String(input.workaround || '').slice(0, 3000),
    spending_signal: String(input.spending_signal || '').slice(0, 2000)
  };
}
