# Agent Contracts — who owns what

Document Writer uses domain-scoped specialists. Each specialist owns a
slice of the document DSL. The Director enforces boundaries by choosing
whom to delegate to.

**Key design rule (learned the hard way):** tools do not call LLMs. When
prose or a vision judgment is needed, the responsible specialist uses
its OWN gateway (declared in its YAML) to produce the content, then
calls a pure state-mutation tool to persist it. This keeps model choice,
routing, cost, and caching in the framework — not scattered across tool
files.

## Ownership matrix

| Concern | Owner | DSL fields it may mutate |
|---|---|---|
| Source ingest (PDFs, URLs, notes, data) | **Source** | `sources.*` |
| Section list, order, targets | **Outline** | `outline[]`, indirectly `sections[]` (drops content on delete) |
| Prose per section | **Draft** | `sections[id].content`, `sections[id].cites` (derived), `todos[]` |
| References + citation attachments | **Cite** | `references.*`, `sections[id].cites`, `meta.bib_style` |
| Figure extraction (PDF), description, claim verification | **Vision Analyst** | `figures[]` (add), `figures[id].{description,caption}`, `claims[id].verification`, `claims[id].verified` |
| Figure import + placement + caption | **Figure** | `figures[]` (add/edit `caption`/`placement`/`referenced_in`), `sections[id].figures` |
| Claim extraction from prose | **Claim** | `claims[]`, `sections[id].claims` |
| Venue template + compliance + watermark | **Style** | `venue`, `meta.bib_style`, `outline[]` (appends missing required sections), `meta.venue_pack`, `meta.watermark` |
| Review authoring | **Reviewer** | `reviews[]` |
| Cross-plugin figure gen (delegate ask) | **Figure** requests, Director delegates | `figures[]` (add via import_figure after generation) |
| Outline/plan proposals | **Plan** (read-only) | — |
| Compile targets, unsupported-claim gating | **Director** | via `compile_document` |

Patent-only (activated when `kind === "patent_application"`):

| Concern | Owner | DSL fields it may mutate |
|---|---|---|
| Patent metadata (type, priority_date, inventors) | **Claim Author** | `patent.{type, priority_date, inventors}` |
| Independent + dependent claim authoring | **Claim Author** | `patent.claims_tree[]` (add/update) |
| Prior-art registration + novelty verdicts | **Prior Art** | `patent.prior_art[]`, `patent.claims_tree[id].novelty` |
| Hierarchy validation | **Claim Author** (via check_claim_hierarchy) | — |

## Cross-cutting rules

1. **Always read before writing.** Every specialist starts with
   `get_document(slug)` — the DSL may have changed since it was last
   invoked. Never assume ids are stable across turns unless the
   Director provided them explicitly.

2. **One domain per delegation.** The Director does not stack more than
   one specialist per turn. After each finishes, the Director re-reads
   the document and decides the next step. Compounded delegations
   cause id collisions and lost work.

3. **Snapshot before destructive edits.** `delete_section`, full
   `set_outline` replacement, or `dedupe_references` on a large ref
   list should be preceded by `snapshot_document`.

4. **Never invent a citation.** The Draft Agent may only emit `[ref_id]`
   tokens for ids present in `doc.references`. If a needed reference is
   missing, the Draft Agent leaves a TODO (`add_todo`) and the Cite
   Agent resolves it.

5. **Never verify what you cannot see.** The Vision Analyst prefers
   `verdict: "inconclusive"` over guessing when a figure is unreadable.

6. **Compiler is source of truth for outputs.** No specialist writes to
   `document.md`, `refs.bib`, or `exports/*` directly. The compilers
   own those.

## Handoff format

Every specialist ends its turn with a structured handoff:

```
<AGENT>_HANDOFF
Task: <one sentence>
Changes: <ids / counts>
State summary: <compact fact, e.g. "6 sections, 12 refs, 3 unverified claims">
Next agent: source | outline | draft | cite | vision-analyst | director
```

The Director reads only this handoff — the full tool trace is not
forwarded. So the handoff must be self-contained.

## Escalation

- **Missing prerequisite** (e.g. Draft asked to write a section not in
  outline): handoff with `Next agent: outline` and a precise ask.
- **Ambiguous brief**: handoff with `Next agent: director` and a
  concrete question.
- **Provider degraded** (e.g. PDF extract returned near-zero text):
  handoff pointing at the env var to configure
  (`RESEARCH_PDF_PROVIDER=mistral`).

## Boundaries — quick reference

| Task | Right agent |
|---|---|
| "Ingest these 3 PDFs" | Source |
| "Look up DOI 10.xxxx" | Cite |
| "Set the outline to NeurIPS structure" | Outline (or Style: `apply_venue_template neurips`) |
| "Draft the Method section" | Draft |
| "Attach [smith2024] and [chen2023] to Method" | Cite |
| "Import this diagram as Figure 3" | Figure |
| "Place Figure 3 in Method and Results" | Figure |
| "Extract figures from smith2024.pdf" | Vision Analyst |
| "Describe Figure 2" | Vision Analyst |
| "Verify our O(n log n) claim against Figure 2" | Vision Analyst |
| "List every unsupported claim in the paper" | Claim (`list_unsupported_claims`) |
| "Extract quantitative claims from Results" | Claim |
| "Check we're within the NeurIPS 9-page limit" | Style (`check_length` + `check_venue_compliance`) |
| "Mark this DRAFT until claims are verified" | Style (`set_watermark`) — or leave unset, auto-DRAFT kicks in |
| "Stop stamping DRAFT even though claims are unverified" | Style (`set_watermark(text: null)`) |
| "Give me a harsh_academic review of the draft" | Reviewer |
| "Compile to PDF" / "DOCX" / "USPTO XML" | Director (`compile_document`) |
| "Merge duplicate references" | Cite (`dedupe_references`) |
| "Add an independent claim about the coupling method" *(patent)* | Claim Author |
| "Narrow claim 1 to avoid overlap with prior art" *(patent)* | Claim Author |
| "Add US Patent 1,234,567 as prior art" *(patent)* | Prior Art |
| "Assess novelty of every patent claim" *(patent)* | Prior Art |
| "Check the patent claims tree is well-formed" *(patent)* | Claim Author (`check_claim_hierarchy`) |
