/**
 * Delimited/JSON parsing for the data-cleanroom plugin.
 *
 * A real state machine, not `split(',')`. The whole value of this plugin is
 * that the parse is deterministic and lossless: quoted delimiters, embedded
 * newlines in quotes, doubled quotes, CRLF, and a BOM all have to survive,
 * and every record has to keep the PHYSICAL line number it came from so a
 * rejected row can be pointed at in the original file.
 *
 * Nothing here throws on malformed input — bad input is data, and the caller
 * routes it to quarantine.
 */

/** Strings that mean "no value", compared case-insensitively. */
export const DEFAULT_NULL_TOKENS = [
  '', 'null', 'nil', 'none', 'na', 'n/a', 'nan', 'undefined', '-', '--', '(null)', '(none)',
];

/** A leading ";" at the end of a record. */
export function stripBom(text) {
  const s = String(text ?? '');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function detectNewline(text) {
  const s = stripBom(String(text ?? ''));
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length - crlf;
  const cr = (s.match(/\r(?!\n)/g) || []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return 'crlf';
  if (cr > lf && cr > 0) return 'cr';
  return 'lf';
}

/**
 * Parse delimited text into records that remember where they came from.
 *
 * @param {string} text
 * @param {{delimiter?: string, quote?: string}} [opts]
 * @returns {{records: Array<{line:number, fields:string[], raw:string}>, warnings:Array<object>, newline:string}}
 */
export function parseDelimited(text, opts = {}) {
  const delimiter = opts.delimiter || ',';
  const quote = opts.quote || '"';
  const src = stripBom(String(text ?? ''));

  const records = [];
  const warnings = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let rawStart = 0;
  let i = 0;
  const n = src.length;

  const pushField = () => { fields.push(field); field = ''; };

  const pushRecord = (endExclusive) => {
    pushField();
    const row = fields;
    fields = [];
    // A line with no delimiter and no content is a blank line, not a record
    // with one empty field. Dropping it keeps line numbers meaningful.
    if (row.length === 1 && row[0].trim() === '') return;
    records.push({ line: recordLine, fields: row, raw: src.slice(rawStart, endExclusive) });
  };

  while (i < n) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === quote) {
        if (src[i + 1] === quote) { field += quote; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      // A newline INSIDE quotes is content, not a record break — but it still
      // advances the physical line counter, which is what makes a quarantine
      // entry point at the right line of the original file.
      if (ch === '\n') line += 1;
      field += ch;
      i += 1;
      continue;
    }

    // Opening quote: allow leading whitespace so ` "x"` is treated as quoted.
    if (ch === quote && field.trim() === '') { inQuotes = true; i += 1; continue; }
    if (ch === delimiter) { pushField(); i += 1; continue; }

    if (ch === '\r') {
      pushRecord(i);
      i += src[i + 1] === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
      rawStart = i;
      continue;
    }
    if (ch === '\n') {
      pushRecord(i);
      i += 1;
      line += 1;
      recordLine = line;
      rawStart = i;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (rawStart < n) pushRecord(n);
  if (inQuotes) {
    warnings.push({
      line: recordLine,
      kind: 'unterminated_quote',
      detail: 'file ended inside a quoted field; the last record may be truncated',
    });
  }

  return { records, warnings, newline: detectNewline(src) };
}

function modal(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestN = -1;
  for (const [value, count] of counts) {
    if (count > bestN) { best = value; bestN = count; }
  }
  return { value: best, count: bestN };
}

/**
 * Sniff the delimiter by parsing with each candidate and preferring the one
 * that yields the most consistent field count. Deliberately costs a parse per
 * candidate rather than counting characters, because counting characters gets
 * `"a,b",c` wrong.
 */
export function sniffDelimiter(text, candidates = [',', '\t', ';', '|']) {
  let best = { delimiter: ',', consistent: 0, fieldCount: 0 };
  for (const delimiter of candidates) {
    const { records } = parseDelimited(text, { delimiter });
    if (records.length === 0) continue;
    const counts = records.slice(0, 50).map(r => r.fields.length);
    const { value: mode, count } = modal(counts);
    if (!mode || mode <= 1) continue;
    const consistent = count / counts.length;
    // Consistency dominates; field count is the tiebreak, which is what stops
    // a file with one stray semicolon beating a clean comma parse.
    if (consistent > best.consistent + 1e-9
      || (Math.abs(consistent - best.consistent) < 1e-9 && mode > best.fieldCount)) {
      best = { delimiter, consistent, fieldCount: mode };
    }
  }
  return best;
}

const NUMERIC_LIKE = /^[+-]?[\d.,\s]*\d[\d.,\s]*$/;

/**
 * Decide whether the first record is a header.
 *
 * The signal is contrast: a header row is non-numeric while the data below it
 * has at least one column that is. With no contrast we default to "header",
 * which is the overwhelming convention and is overridable.
 */
export function looksLikeHeader(records) {
  if (records.length === 0) return { header: false, reason: 'no records' };
  const first = records[0].fields;
  const rest = records.slice(1, 11);
  if (!rest.length) return { header: false, reason: 'single record' };

  const firstNumeric = first.filter(v => NUMERIC_LIKE.test(v.trim()) && v.trim() !== '').length;
  const anyDataNumeric = rest.some(r => r.fields.some(v => NUMERIC_LIKE.test(v.trim()) && v.trim() !== ''));
  const firstHasContent = first.filter(v => v.trim() !== '').length === first.length;

  if (firstNumeric === 0 && anyDataNumeric && firstHasContent) {
    return { header: true, reason: 'first row is non-numeric while the data below has numeric values' };
  }
  if (firstNumeric === 0 && firstHasContent) {
    return { header: true, reason: 'first row has no numeric values' };
  }
  return { header: false, reason: 'first row contains numeric values, so it looks like data' };
}

/** Detect the declared format from a path and a head sample. */
export function detectFormat(filePath, head) {
  const lower = String(filePath || '').toLowerCase();
  const text = stripBom(String(head ?? '')).trimStart();
  if (/\.(jsonl|ndjson)$/.test(lower)) return 'jsonl';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.tsv$|\.[-a-z]*tab$/.test(lower)) return 'tsv';
  if (/\.csv$/.test(lower)) return 'csv';
  if (/\.(xlsx|xls)$/.test(lower)) return 'excel';
  if (/^[[{]/.test(text)) return 'json';
  return 'csv';
}

/** Parse a JSON array of objects into records. */
export function parseJsonArray(text) {
  const warnings = [];
  let data;
  try {
    data = JSON.parse(stripBom(String(text ?? '')));
  } catch (err) {
    return { records: [], warnings: [{ line: 1, kind: 'invalid_json', detail: err.message }] };
  }
  if (!Array.isArray(data)) {
    return { records: [], warnings: [{ line: 1, kind: 'not_an_array', detail: 'JSON document is not an array of objects' }] };
  }
  const records = [];
  for (let i = 0; i < data.length; i += 1) {
    const item = data[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      warnings.push({ line: i + 1, kind: 'non_object_element', detail: `element ${i} is not an object` });
      continue;
    }
    records.push({ line: i + 1, fields: null, object: item, raw: JSON.stringify(item) });
  }
  return { records, warnings };
}

/** Parse JSON-lines into records. */
export function parseJsonLines(text) {
  const warnings = [];
  const records = [];
  const lines = stripBom(String(text ?? '')).split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        warnings.push({ line: i + 1, kind: 'non_object_element', detail: 'line is not a JSON object' });
        continue;
      }
      records.push({ line: i + 1, fields: null, object: item, raw: line });
    } catch (err) {
      warnings.push({ line: i + 1, kind: 'invalid_json', detail: err.message });
    }
  }
  return { records, warnings };
}

/**
 * Turn object records into a fields-arrays matrix with a stable column order.
 * Key order is first-seen, so two files that differ only in key order agree.
 */
export function recordsToMatrix(records) {
  const columns = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record.object || {})) {
      if (!seen.has(key)) { seen.add(key); columns.push(key); }
    }
  }
  const matrix = records.map(record => columns.map(name => {
    const value = (record.object || {})[name];
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }));
  return { columns, matrix };
}
