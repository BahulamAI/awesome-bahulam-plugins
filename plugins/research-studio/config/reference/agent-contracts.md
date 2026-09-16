# Agent Contracts — who owns what

Research Studio uses domain-scoped specialists. Each specialist owns a
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
| Figure extraction, description, claim verification | **Vision Analyst** | `figures[]` (add), `figures[id].{description,caption}`, `claims[id].verification`, `claims[id].verified` |
| Outline/plan proposals | **Plan** (read-only) | — |
| Compile targets, unsupported-claim gating | **Director** | via `compile_document` |
| Cross-plugin figure gen *(Phase 2)* | **Draft** delegates to threejs-studio / manim-studio | `figures[]` (add) |

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
| "Set the outline to NeurIPS structure" | Outline |
| "Draft the Method section" | Draft |
| "Attach [smith2024] and [chen2023] to Method" | Cite |
| "Extract figures from smith2024.pdf" | Vision Analyst |
| "Describe Figure 2" | Vision Analyst |
| "Verify our O(n log n) claim against Figure 2" | Vision Analyst |
| "Compile to PDF" | Director (calls compile_document) |
| "Merge duplicate references" | Cite (dedupe_references) |
