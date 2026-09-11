/**
 * Type inference and coercion.
 *
 * The reason this plugin exists: inferring a column's type from a million
 * messy rows is a deterministic algorithm with a defensible answer, and an
 * LLM guessing per-row is neither. Every decision here is reproducible and
 * carries its evidence, so the report can say WHY a column is TEXT rather
 * than asserting it.
 *
 * The failure mode we are guarding against is silent data corruption:
 *   - leading zeros (zip codes, account numbers) must not become integers
 *   - integers beyond float precision must not lose digits
 *   - "1" is an integer, not a boolean
 */

import { DEFAULT_NULL_TOKENS } from './parse.mjs';

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const INT_RE = /^[+-]?\d+$/;
const REAL_RE = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const BOOL_TRUE = new Set(['true', 't', 'yes', 'y']);
const BOOL_FALSE = new Set(['false', 'f', 'no', 'n']);

/** Types this plugin will infer. TEXT is the safe floor. */
export const INFERRED_TYPES = ['INTEGER', 'REAL', 'BOOLEAN', 'DATE', 'DATETIME', 'TEXT'];

function nullSet(opts) {
  const tokens = Array.isArray(opts?.nullTokens) ? opts.nullTokens : DEFAULT_NULL_TOKENS;
  return new Set(tokens.map(t => String(t).trim().toLowerCase()));
}

function stripGrouping(value, opts) {
  let out = String(value);
  if (opts?.thousandsSeparator) out = out.split(opts.thousandsSeparator).join('');
  if (opts?.currencySymbols) {
    for (const symbol of opts.currencySymbols) out = out.split(symbol).join('');
  }
  return out.trim();
}

/**
 * Classify one raw cell. `null` beats every type, because "no value" is a
 * fact about the data and not a string that happens to be empty.
 *
 * @returns {'null'|'boolean'|'integer'|'real'|'date'|'datetime'|'text'}
 */
export function classifyValue(raw, opts = {}) {
  const trimmed = String(raw ?? '').trim();
  if (nullSet(opts).has(trimmed.toLowerCase())) return 'null';

  const lower = trimmed.toLowerCase();
  if (BOOL_TRUE.has(lower) || BOOL_FALSE.has(lower)) return 'boolean';

  const numeric = stripGrouping(trimmed, opts);
  if (INT_RE.test(numeric)) {
    // Leading zeros mean the digits are an identifier, not a quantity.
    const digits = numeric.replace(/^[+-]/, '');
    const hasLeadingZero = digits.length > 1 && digits.startsWith('0');
    const magnitude = Math.abs(Number(numeric));
    if (hasLeadingZero || magnitude > MAX_SAFE) return 'text';
    return 'integer';
  }
  if (REAL_RE.test(numeric)) return 'real';
  if (DATE_RE.test(trimmed)) return 'date';
  if (DATETIME_RE.test(trimmed)) return 'datetime';
  return 'text';
}

const WIDEN = {
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'DATETIME',
  text: 'TEXT',
};

/**
 * Infer one column's type from its sampled values.
 *
 * The rule is narrowest-widening: the type is the narrowest that holds every
 * non-null value. One stray "n/a" that is NOT in the null tokens drops the
 * column to TEXT — which is the honest answer, and the reason the transform
 * recipe exists so the caller can declare the missing token instead.
 *
 * @returns {{type:string, confidence:number, counts:object, total:number, nonNull:number, reasons:string[]}}
 */
export function inferColumn(values, opts = {}) {
  const counts = { null: 0, boolean: 0, integer: 0, real: 0, date: 0, datetime: 0, text: 0 };
  for (const value of values) counts[classifyValue(value, opts)] += 1;

  const total = values.length;
  const nonNull = total - counts.null;
  const reasons = [];

  if (total === 0 || nonNull === 0) {
    return { type: 'TEXT', confidence: 0, counts, total, nonNull, reasons: ['no non-null values to inspect'] };
  }

  const present = Object.keys(WIDEN).filter(k => counts[k] > 0);
  let type;
  let matched;

  if (present.every(k => k === 'integer')) {
    type = 'INTEGER';
    matched = counts.integer;
  } else if (present.every(k => k === 'integer' || k === 'real')) {
    type = 'REAL';
    matched = counts.integer + counts.real;
    if (counts.real > 0 && counts.integer > 0) reasons.push('mixed integer and decimal values');
  } else if (present.every(k => k === 'boolean')) {
    type = 'BOOLEAN';
    matched = counts.boolean;
  } else if (present.every(k => k === 'date' || k === 'datetime')) {
    type = present.includes('datetime') ? 'DATETIME' : 'DATE';
    matched = counts.date + counts.datetime;
  } else {
    type = 'TEXT';
    matched = counts.text;
    const offenders = present.filter(k => k !== 'text');
    if (offenders.length) {
      reasons.push(`${counts.text} value(s) could not be read as ${offenders.map(o => WIDEN[o]).join('/')}`);
    }
  }

  if (counts.null > 0) reasons.push(`${counts.null}/${total} value(s) were blank or a null token`);

  return { type, confidence: Math.round((matched / nonNull) * 1000) / 1000, counts, total, nonNull, reasons };
}

const TRUE_EXTRA = new Set(['1', 'true', 't', 'yes', 'y']);

/**
 * Coerce one raw cell to the column's chosen type.
 *
 * Returns `{ok:false, reason}` rather than throwing: an uncoercible cell is
 * a rejected row, and rejected rows are evidence, not an exception.
 */
export function coerceValue(raw, type, opts = {}) {
  const value = String(raw ?? '');
  const trimmed = value.trim();
  if (nullSet(opts).has(trimmed.toLowerCase())) return { ok: true, value: null };

  switch (String(type || 'TEXT').toUpperCase()) {
    case 'INTEGER': {
      const numeric = stripGrouping(trimmed, opts);
      if (!INT_RE.test(numeric)) return { ok: false, reason: `not an integer: "${trimmed}"` };
      const parsed = Number(numeric);
      if (Math.abs(parsed) > MAX_SAFE) return { ok: false, reason: `integer out of safe range: "${trimmed}"` };
      return { ok: true, value: parsed };
    }
    case 'REAL': {
      const numeric = stripGrouping(trimmed, opts);
      const parsed = Number(numeric);
      if (!Number.isFinite(parsed)) return { ok: false, reason: `not a number: "${trimmed}"` };
      return { ok: true, value: parsed };
    }
    case 'BOOLEAN': {
      const lower = trimmed.toLowerCase();
      if (BOOL_TRUE.has(lower) || TRUE_EXTRA.has(lower)) return { ok: true, value: 1 };
      if (BOOL_FALSE.has(lower) || lower === '0') return { ok: true, value: 0 };
      return { ok: false, reason: `not a boolean: "${trimmed}"` };
    }
    case 'DATE':
    case 'DATETIME': {
      if (!DATE_RE.test(trimmed) && !DATETIME_RE.test(trimmed)) {
        return { ok: false, reason: `not an ISO date: "${trimmed}"` };
      }
      return { ok: true, value: trimmed.replace(' ', 'T') };
    }
    default:
      return { ok: true, value: trimmed };
  }
}

/**
 * Normalize a source header into a safe SQLite identifier.
 * Deterministic, so the same file always yields the same schema — which is
 * what makes the schema hash (and therefore idempotent reload) work.
 */
export function normalizeHeader(name, ordinal = 0) {
  let out = String(name ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
    .slice(0, 60);
  if (!out) out = `col_${ordinal + 1}`;
  if (!/^[a-z_]/.test(out)) out = `c_${out}`;
  return out;
}

/**
 * Resolve duplicate/invalid headers into a unique set of identifiers.
 * Collisions get `_2`, `_3`, ... so nothing is ever silently dropped.
 */
export function uniqueIdentifiers(names) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < names.length; i += 1) {
    const base = normalizeHeader(names[i], i);
    let candidate = base;
    let n = 1;
    while (used.has(candidate) || !SAFE_IDENT.test(candidate)) {
      n += 1;
      candidate = `${base}_${n}`.slice(0, 63);
    }
    used.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** A stable fingerprint of the accepted schema — the idempotency key. */
export function schemaHash(columns, transformVersion = 1) {
  const payload = columns.map(c => `${c.column_name}:${c.selected_type}`).join('|');
  let hash = 0x811c9dc5;
  const text = `${payload}#v${transformVersion}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
