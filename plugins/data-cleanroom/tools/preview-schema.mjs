/**
 * preview_schema — propose column types without writing anything.
 *
 * The review gate. `load_dataset` will infer types too, but this is the tool
 * the agent calls when a human should see the proposed schema first — and it
 * is where overrides get tested before they are committed to a recipe.
 *
 * Deterministic: the same file and the same samples always produce the same
 * types and the same confidence numbers.
 */

import { inferColumn, normalizeHeader, uniqueIdentifiers, INFERRED_TYPES } from './lib/types.mjs';
import { readAndInspect } from './probe-file.mjs';

export const name = 'preview_schema';
export const description = 'Propose a typed schema for a messy file, with per-column confidence and evidence';

export const DEFAULT_SAMPLE_ROWS = 500;

/**
 * Infer a schema from inspected records.
 *
 * Sampling is deterministic — first N rows plus evenly spaced rows after
 * that — so a preview and a load agree on everything except the rows they
 * looked at, and neither depends on timing.
 */
export function inferSchema(inspected, opts = {}) {
  const sampleRows = Math.max(1, Math.min(10000, Number(opts.sampleRows) || DEFAULT_SAMPLE_ROWS));
  const overrides = opts.overrides || {};
  const nullTokens = opts.nullTokens;

  const records = inspected.records;
  const total = records.length;
  let sample;
  if (total <= sampleRows) {
    sample = records;
  } else {
    const head = records.slice(0, Math.ceil(sampleRows / 2));
    const stride = Math.floor((total - head.length) / (sampleRows - head.length)) || 1;
    const tail = [];
    for (let i = head.length; i < total && tail.length < sampleRows - head.length; i += stride) tail.push(records[i]);
    sample = [...head, ...tail];
  }

  const rawNames = inspected.columns;
  const identifiers = uniqueIdentifiers(rawNames);
  const columns = [];

  for (let i = 0; i < rawNames.length; i += 1) {
    const columnName = identifiers[i];
    const override = overrides[columnName] || overrides[rawNames[i]] || {};
    const values = sample
      .map(record => (record.fields && record.fields[i] !== undefined ? record.fields[i] : ''))
      .filter(v => v !== undefined);

    const inference = inferColumn(values, { nullTokens, ...override });
    let selected = override.explicit_type ? String(override.explicit_type).toUpperCase() : inference.type;
    if (!INFERRED_TYPES.includes(selected)) selected = inference.type;

    const reasons = [...inference.reasons];
    if (override.explicit_type && override.explicit_type.toUpperCase() !== inference.type) {
      reasons.push(`overridden to ${selected} (inference said ${inference.type})`);
    }
    if (selected !== inference.type) {
      reasons.push('an explicit override decides this column');
    }
    if (normalizeHeader(rawNames[i], i) !== String(rawNames[i]).trim().toLowerCase() && /"/.test(String(rawNames[i]))) {
      reasons.push('header contains non-identifier characters');
    }

    columns.push({
      ordinal: i,
      source_name: String(rawNames[i]),
      column_name: columnName,
      inferred_type: inference.type,
      selected_type: selected,
      confidence: inference.confidence,
      candidate_types: inference.counts,
      nullable: inference.counts.null > 0,
      schema_reason: reasons.join('; '),
      sampled: values.length,
      non_null: inference.nonNull,
    });
  }

  return { columns, sampled_records: sample.length, total_records: total };
}

export async function call(args = {}, options = {}) {
  void options;
  const filePath = String(args.path ?? '').trim();
  if (!filePath) return { success: false, output: 'preview_schema: `path` is required' };

  const delimiter = args.delimiter === undefined || args.delimiter === null || args.delimiter === ''
    ? undefined
    : String(args.delimiter).replace('\\t', '\t');

  let inspected;
  try {
    inspected = readAndInspect(filePath, { delimiter, format: args.format ? String(args.format).toLowerCase() : undefined });
  } catch (err) {
    return { success: false, output: `preview_schema: ${err.message}` };
  }
  if (inspected.unsupported) {
    return { success: false, output: `preview_schema: ${inspected.unsupported_reason}` };
  }

  const overrides = args.column_overrides && typeof args.column_overrides === 'object' ? args.column_overrides : {};
  const inferred = inferSchema(inspected, {
    sampleRows: args.sample_rows,
    overrides,
    nullTokens: Array.isArray(args.null_tokens) ? args.null_tokens : undefined,
  });

  const low = inferred.columns.filter(c => c.confidence < 0.9 && c.non_null > 0);

  return {
    success: true,
    output: {
      path: inspected.path,
      format: inspected.format,
      delimiter: inspected.delimiter === '\t' ? '\\t' : inspected.delimiter,
      header_mode: inspected.header_mode,
      record_count: inspected.records.length,
      sampled_records: inferred.sampled_records,
      columns: inferred.columns.map(c => ({
        ordinal: c.ordinal,
        source_name: c.source_name,
        column_name: c.column_name,
        inferred_type: c.inferred_type,
        selected_type: c.selected_type,
        confidence: c.confidence,
        candidate_types: c.candidate_types,
        nullable: c.nullable,
        reason: c.schema_reason || null,
      })),
      // Surfaced explicitly so the agent knows which columns are worth a
      // human's attention before anything is loaded.
      low_confidence_columns: low.map(c => c.column_name),
      parse_warnings: inspected.warnings.slice(0, 25),
      ragged_rows: inspected.stats.ragged_rows,
    },
  };
}
