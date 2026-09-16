# research-studio

Compositional research-document studio. Produces **research papers**, **patent applications**, **technical reports**, and **grant proposals** from source material (PDFs, notes, experimental data, URLs). Documents live as a JSON DSL, compile to Markdown / LaTeX / PDF (via pandoc) on every mutation. Domain specialists — **Source**, **Outline**, **Draft**, **Cite**, **Vision Analyst** — each own a slice of the DSL and are orchestrated by a Research Director.

## Prerequisites

- Node.js (implicit from the CLI runtime).
- Optional: `pandoc` + `pdflatex` for PDF export (LaTeX target works without).
- Optional API keys for real providers:
  - `MISTRAL_API_KEY` — layout-aware PDF extraction (`RESEARCH_PDF_PROVIDER=mistral`).
  - `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — vision-capable gateway for figure descriptions / claim verification (the Vision Analyst agent picks the model via its own gateway config, not through a tool).

## Quick start

```bash
# From the awesome-bahulam-plugins repo root
node plugins/research-studio/selftest.mjs
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
4. Persistence       SQLite (research_documents, research_compilations) + snapshots + sources
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
                     ┌─ Research Director ─────────────┐
                     │                                 │
                     ▼                                 ▼
                  Planner                          (compile_document
                (read-only)                         gates on claims)
                     │
       ┌──────┬──────┼──────┬──────┐
       ▼      ▼      ▼      ▼      ▼
     Source Outline Draft  Cite  Vision Analyst
```

| Agent | Owns | Gateway | File |
|-------|------|---------|------|
| **Research Director** | orchestration + user-facing | text (default) | `config/workspace.yaml` |
| **Plan** | outline & source-ingest plan (read-only) | text | `config/agents/plan.yaml` |
| **Source** | `sources.*` | text | `config/agents/source.yaml` |
| **Outline** | `outline[]` | text | `config/agents/outline.yaml` |
| **Draft** | `sections[id].content` (via its own gateway) | **text-strong** for prose | `config/agents/draft.yaml` |
| **Cite** | `references.*`, `sections[id].cites`, `meta.bib_style` | text | `config/agents/cite.yaml` |
| **Vision Analyst** | `figures[]`, `claims[id].verification` (via its own vision gateway) | **vision-capable** | `config/agents/vision-analyst.yaml` |

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
| `pdf` | `<slug>/exports/document.pdf` | `pandoc` on PATH (uses pdflatex if present) |

Compile refuses non-Markdown targets while unverified claims exist — override with `allow_unsupported_claims: true` for draft snapshots.

## Venue templates

Under `config/venues/`, each YAML declares document class, packages, bib style, required/recommended sections, and page limits. Ships with:

- `arxiv` — flexible, plain BibTeX
- `ieee-conf` — IEEEtran two-column
- `neurips` — NeurIPS 2024, natbib, 9-page hard limit
- `acl` — ACL/EMNLP/NAACL, natbib, Limitations required

Add new venues by dropping a YAML file — no code change.

## Panels (workspace views)

- **Research Studio** (`workspace/studio.html`) — document gallery with word counts, kind/venue badges, links to `document.md`.

Phase 2 will add References, Sources, and Compile panels.

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
plugins/research-studio/
├── plugin.yaml
├── tools/
│   ├── lib.mjs                       # DSL helpers + state
│   ├── document-compile.mjs          # md + tex + bib emitters
│   ├── document-io.mjs               # loadOrCreate / saveAndSync
│   ├── create-document.mjs / get-document.mjs / snapshot-document.mjs / compile-document.mjs
│   ├── ingest-pdf.mjs / ingest-url.mjs / add-note.mjs / add-experiment.mjs / list-sources.mjs
│   ├── set-outline.mjs / add-section.mjs / reorder-sections.mjs / delete-section.mjs
│   ├── set-section-content.mjs / add-todo.mjs
│   ├── add-reference.mjs / lookup-doi.mjs / attach-citation.mjs / format-bibliography.mjs / dedupe-references.mjs
│   ├── extract-figures-from-pdf.mjs / set-figure-description.mjs / set-claim-verdict.mjs
│   └── providers/                    # pdf (local + mistral), ref (local + crossref) — no LLM providers here
├── config/
│   ├── workspace.yaml                # Research Director
│   ├── agents/                       # plan / source / outline / draft / cite / vision-analyst
│   ├── venues/                       # arxiv / ieee-conf / neurips / acl
│   └── reference/                    # document-dsl.md + agent-contracts.md
├── workspace/
│   └── studio.html                   # document gallery
├── selftest.mjs                      # 50+ assertions, all offline
└── README.md
```

## Roadmap — Phase 2

- **Figure Agent** — import/generate figures; cross-plugin delegation to `threejs-studio` (3D-rendered figures) and `manim-studio` (last-frame PNG from animations).
- **Claim Agent** — extract claims from prose, link to sources automatically, `list_unsupported_claims`.
- **Style Agent** — `apply_venue_template`, `check_length`, `check_venue_compliance`.
- **Reviewer Agent** — rubric review (novelty / clarity / rigor / contribution) and `simulate_reviewer` personas.
- **Patent path** — Prior-Art Agent (USPTO/EPO/Google Patents search) + Claim-Author Agent (hierarchical claims, scope calibration) + USPTO XML compile target.
- **DOCX export** via pandoc.
- **References + Sources + Compile panels** in the workspace.
