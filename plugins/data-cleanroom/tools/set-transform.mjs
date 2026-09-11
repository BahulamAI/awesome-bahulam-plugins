/**
 * set_transform — record a new normalization recipe.
 *
 * The tool that makes a load reproducible instead of a one-shot. When a
 * column came out TEXT because of a stray "N/A" or a currency symbol, the
 * fix is not to hand-edit rows — it is to declare the token in the recipe and
 * reload, so the next file with the same problem loads clean.
 *
 * Recipes are immutable and versioned: a new version is created, never an
 * edit, so "how was this data loaded?" always has a specific answer.
 *
 * Nothing is reloaded here. This records the recipe; the caller then runs
 * load_dataset with replace: true, which is what makes the reload an
 * explicit, visible act.
 */

import {
  currentTransformVersion, insertTransforms, logEvent, nowIso,
  readColumns, readTransformOverrides, requireDataset, setStatus, touchDataset,
} from './lib/catalog.mjs';
import { INFERRED_TYPES } from './lib/types.mjs';

export const name = 'set_transform';
export const description = 'Record a new normalization recipe (type and token overrides) for a dataset, in preparation for a reload';

export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) return { success: false, output: 'set_transform: plugin state unavailable' };

  const resolved = requireDataset(state, args.dataset_id, 'set_transform');
  if (!resolved.ok) return { success: false, output: resolved.output };
  const dataset = resolved.dataset;
  const datasetId = Number(dataset.id);

  const requested = Array.isArray(args.columns) ? args.columns : [];
  if (!requested.length) {
    return { success: false, output: 'set_transform: `columns` must be a non-empty array of overrides' };
  }

  const known = readColumns(state, datasetId);
  const knownNames = new Set(known.map(c => c.column_name));

  const next = {};
  const applied = [];
  for (const entry of requested) {
    if (!entry || typeof entry !== 'object') {
      return { success: false, output: 'set_transform: every entry in `columns` must be an object' };
    }
    const columnName = String(entry.column_name ?? entry.name ?? '').trim();
    if (!columnName) return { success: false, output: 'set_transform: every entry needs a `column_name`' };
    if (!knownNames.has(columnName)) {
      return {
        success: false,
        output: `set_transform: "${columnName}" is not a column of dataset ${datasetId}.`
          + ` Known columns: ${[...knownNames].join(', ')}`,
      };
    }

    const override = {};
    if (entry.explicit_type !== undefined && entry.explicit_type !== null && entry.explicit_type !== '') {
      const type = String(entry.explicit_type).toUpperCase();
      if (!INFERRED_TYPES.includes(type)) {
        return {
          success: false,
          output: `set_transform: \`explicit_type\` for "${columnName}" must be one of ${INFERRED_TYPES.join(', ')}`,
        };
      }
      override.explicit_type = type;
    }
    if (Array.isArray(entry.null_tokens)) override.null_tokens = entry.null_tokens.map(String);
    if (entry.thousands_separator !== undefined && entry.thousands_separator !== null) {
      override.thousands_separator = String(entry.thousands_separator);
    }
    if (Array.isArray(entry.currency_symbols)) override.currency_symbols = entry.currency_symbols.map(String);
    if (entry.trim_mode) override.trim_mode = String(entry.trim_mode);

    if (!Object.keys(override).length) {
      return { success: false, output: `set_transform: no recognised override supplied for "${columnName}"` };
    }
    next[columnName] = override;
    applied.push({ column_name: columnName, override: { ...override } });
  }

  // Carry forward everything that was already decided, so a new version
  // changes only what the caller asked to change.
  const currentVersion = currentTransformVersion(state, datasetId);
  const carried = currentVersion ? readTransformOverrides(state, datasetId, currentVersion) : {};
  const merged = { ...carried, ...next };
  const newVersion = currentVersion + 1;

  insertTransforms(state, datasetId, newVersion, known, merged, 'set_transform');

  const now = nowIso();
  touchDataset(state, datasetId, {});
  setStatus(state, {
    active_dataset: dataset.name,
    dataset_id: datasetId,
    transform_version: newVersion,
    updated_at: now,
  });
  logEvent(state, {
    event: 'transform_set',
    dataset_id: datasetId,
    dataset: dataset.name,
    version: newVersion,
    columns: applied.map(a => a.column_name),
    at: now,
  });

  return {
    success: true,
    output: {
      dataset_id: datasetId,
      previous_version: currentVersion,
      transform_version: newVersion,
      applied,
      carried_forward: Object.keys(carried).filter(k => !next[k]),
      reload_required: true,
      next_step: `call load_dataset with path and replace: true to reload dataset ${datasetId} with recipe v${newVersion}`,
    },
  };
}
