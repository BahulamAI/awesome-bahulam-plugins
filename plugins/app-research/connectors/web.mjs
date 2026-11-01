import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import { canonicalUrl, normalize } from '../core/validation.mjs';

// Pin the resolved address in the HTTP request, including redirects, to prevent
// fetched pages from reaching localhost/private infrastructure via DNS rebinding.
export function isPublicAddress(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  // Conservatively accept only global unicast IPv6; IPv4-mapped is excluded.
  return net.isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');
}
export async function requestPublic(input, { headers = {}, maxBytes = 1500000, timeout = 15000, redirects = 3 } = {}) {
  const url = new URL(canonicalUrl(input));
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Only standard web ports are supported');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Source must resolve to public internet addresses');
  const address = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, { headers: { 'User-Agent': 'BahulamAppResearch/0.1', 'Accept-Encoding': 'identity', ...headers },
      lookup: (_h, opts, cb) => opts.all ? cb(null, [address]) : cb(null, address.address, address.family) }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > maxBytes) req.destroy(new Error('Source exceeds retrieval size limit')); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), url: url.toString() }));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('Source request timed out')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (!redirects || !result.headers.location) throw new Error('Source redirect limit reached');
    // Never forward API credentials to a redirect target.
    return requestPublic(new URL(result.headers.location, url).toString(), { maxBytes, timeout, redirects: redirects - 1 });
  }
  if (result.status < 200 || result.status >= 300) throw new Error(`Source returned HTTP ${result.status}`);
  return result;
}

export function htmlText(html) {
  return normalize(String(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '; })
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (_, e) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[e]));
}
export async function fetchSource(url) {
  const r = await requestPublic(url);
  const type = String(r.headers['content-type'] || '');
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) throw new Error('Unsupported source type; import a text excerpt with provenance instead');
  const content = /html/i.test(type) ? htmlText(r.text) : normalize(r.text);
  if (content.length < 80) throw new Error('Source did not contain enough readable text');
  if (/just a moment|verify you are human|enable javascript and cookies/i.test(content.slice(0, 800))) throw new Error('Source access challenge; content not collected');
  return { content: content.slice(0, 100000), truncated: content.length > 100000, final_url: r.url };
}
export async function searchWeb(query, { key, country, language }) {
  if (!key) throw new Error('Configure the Brave Search key in plugin settings');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.search = new URLSearchParams({ q: query, count: '5', country, search_lang: language }).toString();
  const r = await requestPublic(url.toString(), { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
  const data = JSON.parse(r.text);
  if (!Array.isArray(data.web?.results) && data.web !== undefined) throw new Error('Search provider returned an unexpected response');
  return (data.web?.results || []).slice(0, 5).map(x => ({ url: canonicalUrl(x.url), title: String(x.title || ''), snippet: String(x.description || '') }));
}
