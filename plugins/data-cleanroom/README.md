# data-cleanroom

Turns a messy tabular file into a **typed, queryable SQLite warehouse table** plus a
**computed data-quality report** — and accounts for every row it refuses to load.

The premise: a data file that cannot be described is not usable, and a row that
disappears silently is worse than a row that fails loudly. So this plugin does six
things, deterministically:

1. **Parses properly.** A real CSV state machine — quoted delimiters, embedded
   newlines, doubled quotes, BOM, CRLF, delimiter sniffing — not `split(',')`.
2. **Types every column.** Inference with per-column confidence and the competing
   candidate types, so ambiguity is visible instead of guessed.
3. **Keeps a recipe.** Normalization is versioned and immutable, so a load is
   reproducible rather than a one-shot hand-fix.
4. **Records provenance.** sha256, size, mtime, encoding, delimiter, and a physical
   source line number on every row.
5. **Quarantines what will not coerce** — raw text plus the field-level reason,
   next to the load it belonged to.
6. **Profiles the result.** Null rates, duplicates, constants, high cardinality,
   Tukey outliers, candidate keys.

## Install

```bash
bahulam install https://github.com/BahulamAI/awesome-bahulam-plugins --subdir plugins/data-cleanroom
bahulam info data-cleanroom
```

## Quickstart

> load ~/data/sales-2024.csv as "sales"

The agent probes the file, shows you the proposed schema, loads it, and reports the
rejects:

> profile it and tell me what's wrong with it

> which rows were rejected, and why?

## Requirements

- **Node 22.5+** — the warehouse uses the built-in `node:sqlite`. There is no JSON
  fallback and there never will be: the whole point is storing *typed* rows, and a
  key-value fallback would silently corrupt that promise. Without `node:sqlite` the
  tool reports a clear error.
- No network access, no credentials, no bundled dependencies.

## Supported formats

| Format | Status |
| --- | --- |
| CSV | supported — delimiter sniffed or forced |
| TSV | supported |
| JSON (array of objects) | supported |
| JSONL / NDJSON | supported — a bad line is a warning, not a failure |
| Excel (`.xlsx`, `.xls`) | **detected and refused, explicitly** |

Excel is *recognised* so you get a straight answer ("this is a spreadsheet, export
it as CSV") rather than a file parsed as garbage CSV. Bundling a spreadsheet engine
was rejected deliberately.

## Where things live

Two stores, on purpose:

- **The catalog** — declared in `plugin.yaml`, so the CLI owns it and migrates it
  additively. It holds *bookkeeping*: `datasets`, `sources`, `columns`, `issues`,
  `load_runs`, `transforms`, `quality_reports`. This is visible to the agent.
- **The warehouse** — this plugin's own SQLite file, holding the **rows**:
  ```
  ~/.bahulam/data/data-cleanroom/warehouse.sqlite
  ```
  Override the directory with `BAHULAM_DATA_CLEANROOM_DIR`.

Why the split matters: dataset schemas are only known at runtime, so they cannot be
declared as fixed manifest tables. And because generated tools (`state.readTable()`)
only reach *declared* tables, **raw rows can never be swept into the agent's
automatic context** — the catalog is visible, the data is not. Data is fetched
deliberately, via `query_dataset`.

Dataset tables are namespaced by catalog id (`dataset_<id>_<slug>`) so two files may
share a slug; rejected rows go to `quarantine_<id>` in the same file, so a
quarantined row can never be separated from the load it came from.

## The pipeline

```
probe_file ──▶ preview_schema ──▶ load_dataset ──▶ profile_dataset ──▶ export_report
   (read)         (read)            (write)           (compute)          (artifact)
                                      │
                                      ├─▶ rows        → dataset_<id>_<slug>
                                      └─▶ rejects     → quarantine_<id>
                                                          ▲
                                        set_transform ────┘ (versioned recipe)
                                        get_quarantine ─── (read the rejects)
                                        query_dataset ──── (read-only SELECT)
```

Every row written carries `_source_line`, the **physical** line in the source file —
the property that makes a quarantine entry actionable.

## Tools

Generated read-only catalog tools (from `config.state.context_tools`):
`list_datasets`, `list_columns`, `list_issues`, `list_load_runs`, `list_reports`.
A filter is applied only when its argument is supplied.

### `probe_file`

Inspect before loading. Writes nothing.

```json
{ "path": "~/data/sales-2024.csv", "sample_rows": 3 }
```

```json
{
  "format": "csv", "delimiter": ",", "encoding": "utf-8-bom", "newline": "crlf",
  "header_mode": "header", "sha256": "9f2c…", "size_bytes": 1048576,
  "stats": { "records": 48211 },
  "ragged_rows": 3,
  "warnings": [{ "line": 812, "kind": "ragged_row", "detail": "expected 7 field(s), found 4" }]
}
```

### `preview_schema`

Propose a typed schema **without** loading. Use it to show a schema for review and to
test `column_overrides` before committing them.

```json
{ "path": "~/data/sales-2024.csv", "column_overrides": { "zip": { "explicit_type": "TEXT" } } }
```

```json
{
  "columns": [
    { "column_name": "zip", "source_name": "ZIP", "inferred_type": "INTEGER",
      "selected_type": "TEXT", "confidence": 0.4, "reason": "leading zeros; forced by override" },
    { "column_name": "amount", "source_name": "Amount", "inferred_type": "REAL",
      "selected_type": "REAL", "confidence": 1 }
  ],
  "low_confidence_columns": ["zip"]
}
```

`inferred_type` and `selected_type` are both kept everywhere: *what the data looks
like* and *what we decided* are different facts, and the gap between them is exactly
where overrides live.

### `load_dataset`

```json
{ "path": "~/data/sales-2024.csv", "name": "sales",
  "column_overrides": { "zip": { "explicit_type": "TEXT" } } }
```

```json
{
  "dataset_id": 1, "table_name": "dataset_1_sales", "load_run_id": 1,
  "rows_seen": 48211, "rows_loaded": 48208, "rows_rejected": 3,
  "schema_hash": "4b1e…", "transform_version": 1,
  "next_step": "call get_quarantine to see why rows were rejected"
}
```

### `profile_dataset`

```json
{ "dataset_id": 1 }
```

### `query_dataset`

Read-only SELECT against this dataset's table.

```json
{ "dataset_id": 1, "sql": "SELECT region, COUNT(*) AS n, AVG(amount) AS avg_amount FROM dataset_1_sales GROUP BY region ORDER BY n DESC LIMIT 10" }
```

Aggregates are the point — the agent summarises without 48,000 rows entering context.

### `get_quarantine`

```json
{ "dataset_id": 1, "limit": 100 }
```

```json
{
  "rejected_count": 3,
  "rows": [{ "load_run_id": 1, "source_line": 812, "raw_record": "9911,,,n/a", "errors_json": "[{\"column\":\"amount\",\"reason\":\"not a number\"}]" }],
  "reasons": [{ "reason": "expected 7 field(s), found 4", "count": 2 }]
}
```

### `set_transform`

Record a **new version** of the normalization recipe. Nothing is reloaded — call
`load_dataset` with `replace: true` afterwards. Prior versions are never edited.

```json
{ "dataset_id": 1, "columns": [{ "column_name": "amount", "currency_symbols": ["$"], "thousands_separator": "," }] }
```

```json
{ "transform_version": 2, "reload_required": true }
```

This is what stops normalization from being a one-shot hand-fix: the recipe that
produced a load is on disk and reproducible.

### `export_report`

```json
{ "dataset_id": 1, "format": "markdown" }
```

```json
{ "format": "markdown", "bytes": 4820, "profiled": true, "finding_count": 6, "artifact": "# Data quality report — sales\n…" }
```

`format` is `json`, `csv` (column metrics) or `markdown`. Output is deterministic —
two exports of the same data are byte-identical.

## Idempotency

Re-loading the same file with the same schema is a **success that writes nothing**,
and says so:

```json
{ "already_loaded": true, "load_run_id": 1, "rows_loaded": 48208 }
```

The identity is `(dataset_id, sha256, schema_hash, transform_version)`. A *changed*
file creates a **new** `sources` row and a new `load_run` — provenance is immutable,
so a re-ingest adds history instead of erasing it. A name clash with different
contents is refused unless you pass `replace: true`, which drops and recreates that
dataset's data and quarantine tables.

A load that fails half-way leaves a `load_run` row with `status: 'failed'` and the
error, rather than pretending it never happened. Rows are inserted in transactions,
so a batch failure rolls back instead of leaving a silently short table.

## Report definitions

Per column: `null_count` / `null_rate`, `distinct_count` / `distinct_ratio`,
`min_value`, `max_value`, `mean_value` (numeric columns), `outlier_count`,
`is_constant`. Per dataset: `duplicate_rows`, `candidate_keys`.

Findings (`issues`), each with `severity` (`high` / `medium` / `low`), a `count`, and
evidence:

| `issue_type` | Raised when |
| --- | --- |
| `all_null` | every row in the column is null |
| `null_rate` | nulls ≥ 20% of rows (≥ 50% is `high`) |
| `constant_column` | exactly one distinct non-null value |
| `duplicate_rows` | a row is an exact duplicate of another |
| `high_cardinality` | near-unique values, e.g. an id masquerading as a category |
| `outlier` | numeric values outside Tukey's IQR fences |

Profiling is repeatable: re-running replaces the report for that dataset instead of
accumulating duplicate findings.

## Security

The query tool is a **guard rail, not a sandbox**. It rejects anything that is not a
single `SELECT`/`WITH`, rejects a semicolon-smuggled second statement, rejects write
and schema keywords anywhere in the text (including inside a subquery), and refuses
to name any table other than the requested dataset's own table. Row output is capped.

Every SQL identifier that reaches a statement is generated by the plugin and
validated against `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. Values are always bound as
parameters — never interpolated. `where` clauses in the generated catalog tools are
author-supplied predicate fragments, and the CLI binds their values.

The data is local and the caller is trusted-ish; the point is that a generated tool
should never be the thing that lets an agent `DROP` a table.

## Workspace panel

`Data Cleanroom` renders as a central-panel tab: the dataset catalog, the provenance
card (sha256, size, encoding, delimiter), the typed schema with per-column
confidence, live load progress, the quality report, the quarantine table with source
lines and reasons, and a query console scoped to the selected dataset.

It is a live shared canvas: it loads from state on mount and repaints on
`plugin_state_changed` — both the precise event for this plugin and the server's
coarse `{kind: '*'}` pulse — with a slow poll as insurance.

## Selftest

```bash
node plugins/data-cleanroom/selftest.mjs
```

Runs the parser, the type inference, the SQL guard, and the whole pipeline against
`node:sqlite` — a `:memory:` database for the catalog and a real temporary warehouse
file for the rows. The plugin never imports the CLI. The warehouse is redirected with
`BAHULAM_DATA_CLEANROOM_DIR` so a test run can never touch real data.

Covers BOM and CRLF, quoted commas, escaped quotes, embedded newlines, TSV sniffing,
ragged rows, duplicate headers, leading zeros preserved as text, integer overflow,
currency and thousands separators, date ambiguity, boolean tokens, empty/`NULL`/`NA`/
`-` handling, quarantine line numbers, idempotency, provenance on change, transform
versioning, report persistence, and every rejected-query form.
