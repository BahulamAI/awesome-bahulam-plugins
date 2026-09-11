/**
 * probe_file — inspect a file before committing to a load.
 *
 * The look-before-you-leap step. It reads the file, hashes it, sniffs the
 * format and delimiter, and reports the parse warnings with PHYSICAL line
 * numbers. It writes nothing: probing a file must never be able to change
 * the catalog.
 *
 * Splitting probe out of load is what lets the agent show a schema for
 * approval before a million rows land in the warehouse.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  detectFormat, detectNewline, looksLikeHeader, parseDelimited,
  parseJsonArray, parseJsonLines, recordsToMatrix, sniffDelimiter, stripBom,
} from './lib/parse.mjs';

export const name = 'probe_file';
export const description = 'Inspect a messy data file: format, delimiter, encoding, size, hash and parse warnings';

/** Beyond this we would be reading the file twice for no benefit. */
export const MAX_FILE_BYTES = 128 * 1024 * 1024;

/**
 * Decode a buffer to text, honouring a byte-order mark.
 * Only the encodings we can detect unambiguously are claimed — guessing at
 * Latin-1 from invalid UTF-8 would silently mangle text.
 */
export function decodeBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: stripBom(buffer.slice(3).toString('utf8')), encoding: 'utf-8-bom' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.slice(2).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.slice(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be' };
  }
  return { text: buffer.toString('utf8'), encoding: 'utf-8' };
}

/**
 * Read a file and extract everything a caller needs to decide what to do
 * with it. Exported so load-dataset reuses the exact same detection rather
 * than reimplementing it and drifting.
 */
export function readAndInspect(filePath, opts = {}) {
  const resolved = path.resolve(String(filePath));
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`${resolved} is not a regular file`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${resolved} is ${stat.size} bytes; the limit is ${MAX_FILE_BYTES} bytes. Split the file first.`);
  }

  const buffer = fs.readFileSync(resolved);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const { text, encoding } = decodeBuffer(buffer);
  const format = opts.format || detectFormat(resolved, text.slice(0, 4096));

  // Excel is a zip of XML, not text. Claiming to support it would be a lie.
  if (format === 'excel') {
    return {
      path: resolved,
      sha256,
      size_bytes: stat.size,
      mtime_ms: Math.round(stat.mtimeMs),
      encoding,
      format,
      unsupported: true,
      unsupported_reason: 'Excel workbooks are not plain text. Export to CSV first — this plugin does not silently guess at a spreadsheet.',
      nextline: null,
      delimiter: null,
      header_mode: null,
      columns: [],
      records: [],
      warnings: [],
      stats: { physical_lines: 0, records: 0, blank_lines: 0, ragged_rows: 0 },
    };
  }

  let records = [];
  let warnings = [];
  let delimiter = opts.delimiter || null;
  let columns = [];
  let newline = detectNewline(text);
  let headerMode = null;
  let headerReason = null;

  if (format === 'json' || format === 'jsonl') {
    const parsed = format === 'json' ? parseJsonArray(text) : parseJsonLines(text);
    warnings = parsed.warnings;
    const matrix = recordsToMatrix(parsed.records);
    columns = matrix.columns;
    records = matrix.matrix.map((fields, i) => ({
      line: parsed.records[i].line,
      fields,
      raw: parsed.records[i].raw,
    }));
    headerMode = 'keys';
    headerReason = 'JSON object keys define the columns';
  } else {
    if (!delimiter) {
      const sniffed = sniffDelimiter(text);
      delimiter = sniffed.delimiter;
    }
    const parsed = parseDelimited(text, { delimiter });
    warnings = parsed.warnings;
    newline = parsed.newline;
    records = parsed.records;

    const headerDecision = looksLikeHeader(records);
    headerMode = headerDecision.header ? 'header' : 'none';
    headerReason = headerDecision.reason;

    if (headerDecision.header && records.length) {
      columns = records[0].fields;
      records = records.slice(1);
    } else {
      const width = records.length ? records[0].fields.length : 0;
      columns = Array.from({ length: width }, (_, i) => `col_${i + 1}`);
    }
  }

  // Ragged rows are kept (they are evidence, and a load quarantines them),
  // but they are counted here so the caller can see them before loading.
  let ragged = 0;
  for (const record of records) {
    if (record.fields.length !== columns.length) ragged += 1;
  }

  return {
    path: resolved,
    sha256,
    size_bytes: stat.size,
    mtime_ms: Math.round(stat.mtimeMs),
    encoding,
    format,
    unsupported: false,
    newline,
    delimiter,
    header_mode: headerMode,
    header_reason: headerReason,
    columns,
    records,
    warnings,
    stats: {
      physical_lines: text.split(/\r\n|\n|\r/).length,
      records: records.length,
      ragged_rows: ragged,
      warnings: warnings.length,
    },
  };
}

export async function call(args = {}, options = {}) {
  void options;
  const filePath = String(args.path ?? '').trim();
  if (!filePath) return { success: false, output: 'probe_file: `path` is required' };

  const delimiter = args.delimiter === undefined || args.delimiter === null || args.delimiter === ''
    ? undefined
    : String(args.delimiter).replace('\\t', '\t');
  const sampleRows = Math.max(1, Math.min(50, Number(args.sample_rows) || 5));

  let inspected;
  try {
    inspected = readAndInspect(filePath, { delimiter, format: args.format ? String(args.format).toLowerCase() : undefined });
  } catch (err) {
    return { success: false, output: `probe_file: ${err.message}` };
  }

  if (inspected.unsupported) {
    return {
      success: false,
      output: `probe_file: ${inspected.unsupported_reason}`,
      detail: { path: inspected.path, format: inspected.format },
    };
  }

  return {
    success: true,
    output: {
      path: inspected.path,
      sha256: inspected.sha256,
      size_bytes: inspected.size_bytes,
      mtime_ms: inspected.mtime_ms,
      encoding: inspected.encoding,
      format: inspected.format,
      newline: inspected.newline,
      delimiter: inspected.delimiter === '\t' ? '\\t' : inspected.delimiter,
      header_mode: inspected.header_mode,
      header_reason: inspected.header_reason,
      columns: inspected.columns,
      column_count: inspected.columns.length,
      sample_rows: inspected.records.slice(0, sampleRows).map(r => ({ line: r.line, fields: r.fields })),
      stats: inspected.stats,
      warnings: inspected.warnings.slice(0, 25),
      // The count that matters before a load: rows with the wrong width will
      // be quarantined rather than silently shifted into the wrong columns.
      ragged_rows: inspected.stats.ragged_rows,
    },
  };
}
