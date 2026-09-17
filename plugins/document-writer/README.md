# document-writer

Compositional document writer. Produces **research papers**, **patent applications** (with full USPTO XML output), **technical reports**, **grant proposals**, and **literature reviews** from source material (PDFs, notes, experimental data, URLs). Documents live as a JSON DSL, compile to Markdown / LaTeX / PDF / DOCX / USPTO XML on demand. Watermarking (DRAFT / CONFIDENTIAL / auto-DRAFT when unverified claims exist) renders across every target. Domain specialists — **Source**, **Outline**, **Draft**, **Cite**, **Vision Analyst**, **Figure**, **Claim**, **Style**, **Reviewer**, plus patent-only **Prior Art** and **Claim Author** — each own a slice of the DSL and are orchestrated by a Document Director.

## Prerequisites

- Node.js (implicit from the CLI runtime).
- Optional: `pandoc` + `pdflatex` for PDF export (LaTeX target works without).
- Optional API keys for real providers:
  - `MISTRAL_API_KEY` — layout-aware PDF extraction (`RESEARCH_PDF_PROVIDER=mistral`).
  - `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — vision-capable gateway for figure descriptions / claim verification (the Vision Analyst agent picks the model via its own gateway config, not through a tool).

## Quick start

```bash
# From the awesome-bahulam-plugins repo root
node plugins/document-writer/selftest.mjs
```

## Design principles

1. **Every claim traces to a source.** `compile_document` refuses non-Markdown targets while unverified claims exist unless `allow_unsupported_claims: true` is passed.
2. **Every reference is real.** `lookup_doi` + `dedupe_references` keep phantom citations out. The Draft Agent may only emit `[ref_id]` tokens that already exist in `doc.references`; unresolved tokens are surfaced by `set_section_content`.
3. **Tools do not call LLMs.** Prose writing, figure description, and claim verification are the work of the agent's own gateway (declared per-agent in YAML). Tools are pure state mutators — no model choice inside them.
4. **Same shape as siblings.** Same 4-layer split as `threejs-studio` and `manim-studio` — DSL / compiler / tools / persistence — so author fluency transfers.

## 4-layer architecture

```
1. Source layer      document.json (DSL) — outline, sections, refs, figures, claims, sources
2. Composition layer compile(doc) → document.md + refs.bib always in sync; tex/pdf on demand
3. Authoring layer   ~25 tools grouped by specialist (all pure state mutations)
4. Persistence       SQLite (documents, compilations) + snapshots + sources
```

## Document folder layout

```
<cwd>/<slug>/
├── document.json       # DSL — source of truth
├── document.md         # regenerated on every mutation
├── refs.bib            # regenerated on every mutation
├── sources/            # ingested PDFs, notes, URL snapshots, data files
│   └── extracted/      # extracted text (and figures with real PDF provider)
├── figures/            # curated figures for the document
├── snapshots/          # timestamped document.json copies
└── exports/            # generated .tex / .pdf on demand
```

## Agent topology

```
                     ┌─ Document Director ─────────────────────────────┐
                     │                                                 │
                     ▼                                                 ▼
                  Planner                                    (compile_document
                (read-only)                                   gates on claims)
                     │
       ┌──────┬──────┼──────┬──────┬───────┬───────┬────────┬─────────┐
       ▼      ▼      ▼      ▼      ▼       ▼       ▼        ▼         ▼
     Source Outline Draft  Cite  Vision  Figure  Claim   Style   Reviewer
                                Analyst

   Patent-only (kind === "patent_application"):
       ┌──────────────┬──────────────┐
       ▼              ▼              ▼
    Prior Art    Claim Author    (regular flow above still applies)
```

| Agent | Owns | Gateway | File |
|-------|------|---------|------|
| **Document Director** | orchestration + user-facing | text (default) | `config/workspace.yaml` |
| **Plan** | outline & source-ingest plan (read-only) | text | `config/agents/plan.yaml` |
| **Source** | `sources.*` | text | `config/agents/source.yaml` |
| **Outline** | `outline[]` | text | `config/agents/outline.yaml` |
| **Draft** | `sections[id].content` (via own gateway) | **text-strong** for prose | `config/agents/draft.yaml` |
| **Cite** | `references.*`, `sections[id].cites`, `meta.bib_style` | text | `config/agents/cite.yaml` |
| **Vision Analyst** | `figures[]`, `claims[id].verification` (via own vision gateway) | **vision-capable** | `config/agents/vision-analyst.yaml` |
| **Figure** | figure import + placement + caption | text | `config/agents/figure.yaml` |
| **Claim** | claim extraction from prose (via own gateway) | text-strong | `config/agents/claim.yaml` |
| **Style** | venue template + length + compliance | text | `config/agents/style.yaml` |
| **Reviewer** | reviews (via own gateway) | text-strong | `config/agents/reviewer.yaml` |
| **Prior Art** *(patent)* | novelty verdicts vs prior art (via own gateway) | text-strong | `config/agents/prior-art.yaml` |
| **Claim Author** *(patent)* | patent claim authoring + narrowing (via own gateway) | text-strong | `config/agents/claim-author.yaml` |

See [`config/reference/agent-contracts.md`](./config/reference/agent-contracts.md) for the full ownership matrix and handoff format, and [`config/reference/document-dsl.md`](./config/reference/document-dsl.md) for the DSL spec.

## Tools by domain

**Document lifecycle**
- `create_document`, `get_document`, `snapshot_document`, `compile_document`

**Source Agent**
- `ingest_pdf`, `ingest_url`, `add_note`, `add_experiment`, `list_sources`

**Outline Agent**
- `set_outline`, `add_section`, `reorder_sections`, `delete_section`

**Draft Agent** (writes prose via its own gateway, then persists)
- `set_section_content` (parses `[ref_id]` cites, flags unresolved ones)
- `add_todo`

**Cite Agent**
- `add_reference` (structured or BibTeX string), `lookup_doi` (Crossref / local), `attach_citation`, `format_bibliography`, `dedupe_references`

**Vision Analyst** (uses its own vision-capable gateway, then persists)
- `extract_figures_from_pdf` (needs real PDF provider for actual images)
- `set_figure_description`, `set_claim_verdict`

**Figure Agent**
- `import_figure` (local path / URL / relative), `place_figure`, `caption_figure`, `list_figures`

**Claim Agent** (extracts claims via its own gateway, then persists)
- `add_claim`, `link_claim_to_source`, `list_claims`, `list_unsupported_claims`

**Style Agent**
- `apply_venue_template`, `check_length`, `check_venue_compliance`

**Reviewer Agent** (authors review via own gateway, then persists)
- `add_review`, `list_reviews`

**Patent path** (kind === `patent_application`)
- `set_patent_metadata`, `add_claim_tree_item`, `update_claim_tree_item`
- `add_prior_art`, `set_claim_novelty`, `check_claim_hierarchy`

## Provider configuration

Zero-credential defaults for every provider — tool chains always complete:

```bash
# PDF extraction (default local extracts text only; Mistral OCR extracts layout + figures)
export RESEARCH_PDF_PROVIDER=mistral
export MISTRAL_API_KEY=...

# Reference lookup (Crossref default, no key needed; RESEARCH_OFFLINE=1 forces local)
export RESEARCH_CROSSREF_EMAIL=you@example.com   # polite-pool for higher rate limits
```

**Vision and prose generation** are NOT provider adapters — they're the agent's own gateway. Configure the model in `config/agents/vision-analyst.yaml` and `config/agents/draft.yaml`, or override the gateway via workspace config.

## Compile targets

| Target | Path | Requirement |
|---|---|---|
| `md` | `<slug>/document.md` (always in sync) | none |
| `tex` | `<slug>/exports/document.tex` (venue-aware preamble) | none |
| `pdf` | `<slug>/exports/document.pdf` | `pandoc` on PATH (uses `pdflatex` if present) |
| `docx` | `<slug>/exports/document.docx` | `pandoc` on PATH |
| `uspto_xml` | `<slug>/exports/document.xml` | none (patent applications only) |

Compile refuses non-Markdown targets while unverified claims exist — override with `allow_unsupported_claims: true` for draft snapshots.

## Venue templates

Under `config/venues/`, each YAML declares document class, packages, bib style, required/recommended sections, and page limits. Ships with:

- `arxiv` — flexible, plain BibTeX
- `ieee-conf` — IEEEtran two-column
- `neurips` — NeurIPS 2024, natbib, 9-page hard limit
- `acl` — ACL/EMNLP/NAACL, natbib, Limitations required
- `acm` — ACM Reference Format, sigconf, 10-12 page target
- `uspto-utility` — USPTO utility application (patent flow)
- `epo-utility` — EPO utility application (patent flow)
- `nsf-grant` — NSF proposal, 15-page hard limit

Add new venues by dropping a YAML file — no code change.

## Panels (workspace views)

- **Document Writer** (`workspace/studio.html`) — document gallery with word counts, kind/venue badges, links to `document.md`.
- **References** (`workspace/references.html`) — BibTeX table per document with DOI links, bib style.
- **Sources** (`workspace/sources.html`) — ingested PDFs / URLs / experiments per document, provider + extracted-chars badges.
- **Compilations** (`workspace/compile.html`) — history of compile runs with status badges and links to output files.

## Example brief → run

```
User: "Draft a NeurIPS paper on Amoeba Attention from these three PDFs; the claim
       that we scale O(n log n) needs to be verified against Figure 2 of Smith 2024."

1. Director  → plan            : outline + source plan
   Director  → user            : shows outline, gets approval
2. Director  → create_document(name="attn", kind="research_paper", venue="neurips")
   Director  → source          : ingest_pdf x3 (local provider warns about extraction quality)
   Director  → cite            : lookup_doi for each ref; dedupe
   Director  → outline         : set_outline (accepts NeurIPS default)
   Director  → vision-analyst  : extract_figures_from_pdf(source_id="smith2024_pdf")
                                 → describes Figure 2 → set_figure_description
                                 → set_claim_verdict(c1, "supported", figure_ref="fig2")
   Director  → draft           : one section at a time (uses its own gateway)
3. Director  → compile_document(target="tex")
   Director  → user            : cites <cwd>/attn/exports/document.tex + document.md
```

## Plugin source layout

```
plugins/document-writer/
├── plugin.yaml
├── tools/
│   ├── lib.mjs                       # DSL helpers + state
│   ├── document-compile.mjs          # md + tex + bib + uspto_xml emitters
│   ├── document-io.mjs               # loadOrCreate / saveAndSync
│   ├── venue.mjs                     # config/venues/*.yaml reader (no deps)
│   ├── create-document.mjs / get-document.mjs / snapshot-document.mjs / compile-document.mjs
│   ├── ingest-pdf.mjs / ingest-url.mjs / add-note.mjs / add-experiment.mjs / list-sources.mjs
│   ├── set-outline.mjs / add-section.mjs / reorder-sections.mjs / delete-section.mjs
│   ├── set-section-content.mjs / add-todo.mjs
│   ├── add-reference.mjs / lookup-doi.mjs / attach-citation.mjs / format-bibliography.mjs / dedupe-references.mjs
│   ├── extract-figures-from-pdf.mjs / set-figure-description.mjs / set-claim-verdict.mjs
│   ├── import-figure.mjs / place-figure.mjs / caption-figure.mjs / list-figures.mjs
│   ├── add-claim.mjs / link-claim-to-source.mjs / list-claims.mjs / list-unsupported-claims.mjs
│   ├── apply-venue-template.mjs / check-length.mjs / check-venue-compliance.mjs
│   ├── add-review.mjs / list-reviews.mjs
│   ├── set-patent-metadata.mjs / add-claim-tree-item.mjs / update-claim-tree-item.mjs
│   ├── add-prior-art.mjs / set-claim-novelty.mjs / check-claim-hierarchy.mjs
│   └── providers/                    # pdf (local + mistral), ref (local + crossref) — no LLM providers here
├── config/
│   ├── workspace.yaml                # Document Director
│   ├── agents/                       # plan / source / outline / draft / cite / vision-analyst /
│   │                                 # figure / claim / style / reviewer / prior-art / claim-author
│   ├── venues/                       # arxiv / ieee-conf / neurips / acl / acm / uspto-utility / epo-utility / nsf-grant
│   └── reference/                    # document-dsl.md + agent-contracts.md
├── workspace/
│   ├── studio.html                   # document gallery
│   ├── references.html               # BibTeX table per document
│   ├── sources.html                  # ingested sources per document
│   └── compile.html                  # compilation history
├── selftest.mjs                      # 100 assertions, all offline
└── README.md
```

## Roadmap — Phase 3

- **Live prior-art search** — USPTO / EPO / Google Patents API providers (currently `add_prior_art` accepts a manually registered reference).
- **Cross-plugin figure generation** — Director-orchestrated flow that delegates to `threejs-studio` / `manim-studio` for figure rendering, then re-imports the result via `import_figure`. The scaffolding is in place; the concrete orchestrator prompt + example doc is pending.
- **Claim extraction from figure text** — Vision Analyst reads a chart in the paper and proposes `add_claim` calls automatically.
- **Reference deduplication across DOI variants** — currently by-DOI or by-title+year; add fuzzy matching for arXiv → published version.
- **Timeline / diff panel** — inspect `snapshots/*.json` side-by-side.
- **Grant-specific budget-section tools** — separate NIH / NSF budget line-item helpers.
