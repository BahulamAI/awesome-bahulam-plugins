/**
 * venue.mjs — tiny YAML reader for config/venues/*.yaml.
 *
 * The venue packs are simple (flat maps + short lists). To avoid adding
 * a YAML dependency for a handful of small files, we ship a minimal
 * parser that handles the exact subset used in the packs (top-level
 * key: value, lists as `[a, b]` or `- item`, and a `notes: |` block).
 * If the pack contains something the parser can't handle, callers get
 * a partial object — the fields that matter (bib_style, packages,
 * length hints) are all in the supported subset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENUES_DIR = path.resolve(__dirname, '..', 'config', 'venues');

export function listVenues() {
  if (!fs.existsSync(VENUES_DIR)) return [];
  return fs.readdirSync(VENUES_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace(/\.yaml$/, ''));
}

export function loadVenue(key) {
  const file = path.join(VENUES_DIR, `${key}.yaml`);
  if (!fs.existsSync(file)) return null;
  return parseSimpleYaml(fs.readFileSync(file, 'utf-8'));
}

// ── Minimal YAML parser (subset used by venue packs) ────────────────
function parseSimpleYaml(text) {
  const out = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let rest = m[2].trim();
    if (rest === '|' || rest === '|+') {
      // block scalar until dedent
      const buf = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        buf.push(lines[i].replace(/^ {2}/, ''));
        i++;
      }
      out[key] = buf.join('\n').trim();
      continue;
    }
    if (rest === '') {
      // nested block? Try to detect a "- item" list or nested map.
      const nested = [];
      const nestedMap = {};
      i++;
      let isList = null;
      while (i < lines.length && lines[i].startsWith('  ') && lines[i].trim() !== '') {
        const child = lines[i].slice(2);
        if (child.startsWith('- ')) {
          if (isList == null) isList = true;
          nested.push(parseListItem(child.slice(2).trim()));
        } else {
          if (isList == null) isList = false;
          const km = child.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);
          if (km) nestedMap[km[1]] = parseScalar(km[2].trim());
        }
        i++;
      }
      out[key] = isList ? nested : nestedMap;
      continue;
    }
    out[key] = parseScalar(rest);
    i++;
  }
  return out;
}

function parseScalar(raw) {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => parseScalar(s.trim())).filter(v => v !== null || v === null);
  }
  const asNum = Number(raw);
  if (!isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(raw)) return asNum;
  return raw.replace(/^["'](.*)["']$/, '$1');
}

function parseListItem(raw) {
  // Handle `- key: value` (single-line map)
  if (raw.includes(':')) {
    const [k, ...rest] = raw.split(':');
    const v = rest.join(':').trim();
    return { [k.trim()]: parseScalar(v) };
  }
  return parseScalar(raw);
}
