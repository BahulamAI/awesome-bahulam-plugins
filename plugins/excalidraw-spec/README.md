# excalidraw-spec

Points at a repository folder and draws its architecture — then exports it as a
real `.excalidraw` document, a Mermaid diagram, or an onboarding spec.

The idea: drawing architecture diagrams is the universally hated part of
onboarding documentation. The reason is that it is done by hand, from memory,
and is stale the moment it is written. This plugin reads the code instead.

## The one design decision worth explaining

**We emit the Excalidraw file format; we do not embed the Excalidraw app.**

Excalidraw is a React application. Embedding it would mean shipping or fetching a
large bundle, and this repo's security policy forbids fetching remote code
(`CONTRIBUTING.md`). So the plugin does something better:

- It generates a **genuine `.excalidraw` document** — the open format that opens
  in excalidraw.com, the VS Code extension, and Obsidian.
- The workspace panel renders that same scene with a small offline SVG renderer.

Two consequences worth stating. First, the artifact is **yours**: open it in
Excalidraw and keep drawing on top of what was generated. Second, it is
**diffable** — seeds are derived from stable strings, so re-exporting an
unchanged graph is byte-identical and a commit diff shows only real
architectural change.

## The second design decision

**Inference is deterministic; interpretation is the agent's.**

A scanner walks the tree and parses real imports. It does not ask a model to
guess an architecture from folder names. So every box is a folder that exists and
every arrow carries a number of imports that were actually counted.

The agent's job is the part a scanner cannot do: naming layers, retitling a
cryptic folder, and saying in one line what each box is responsible for. The two
are kept in separate columns (`inferred`-style fields vs `label`/`kind`/`layer`)
so the evidence is never overwritten by the interpretation.

## Install

```bash
bahulam install https://github.com/BahulamAI/awesome-bahulam-plugins --subdir plugins/excalidraw-spec
bahulam info excalidraw-spec
```

## Quickstart

> scan /path/to/my-project and draw its architecture

> make this good enough for the onboarding doc

> export it as Markdown

Or drive it from the panel: paste a folder path, press **Scan**, and download
whichever format you want.

## What it does, on a real repository

Run against this repo's own CLI (306 source files, 83,992 lines):

- **27 boxes · 92 dependencies** in under a second
- heaviest edge: `test → src/core`, 52 imports
- `src/core` — 51 files, 17,048 loc, fan-in 151
- `test` — fan-in 0, fan-out 142 → classified `top-level`

That last one is the kind of thing a hand-drawn diagram usually gets wrong:
tests import everything and nothing imports tests, so they sit at the edge of
the graph rather than inside it.

## How it works

```
scan_repository → get_architecture → annotate_architecture → arrange_diagram → export_diagram
   (evidence)        (read it)          (name the parts)       (lay it out)      (deliverable)
```

1. **`scan_repository`** walks the tree, extracts imports, and builds the graph.
2. **`get_architecture`** summarises it: boxes by layer, fan-in/fan-out, entry
   points, the heaviest edges, and the external packages actually used.
3. **`annotate_architecture`** records the agent's judgement — labels, kinds,
   layers, one-line descriptions.
4. **`arrange_diagram`** computes and stores the layout, so dependencies read
   left to right.
5. **`export_diagram`** renders the deliverable.

## Tools

| tool | job |
| --- | --- |
| `scan_repository` | walk a folder, build the graph from real imports |
| `annotate_architecture` | set labels, kinds and layers on boxes |
| `arrange_diagram` | compute and store the layout order |
| `export_diagram` | render excalidraw / mermaid / markdown / json |
| `get_architecture` | summarise the graph instead of listing it |

Generated read-only catalog tools: `list_repos`, `list_nodes`, `list_edges`,
`list_exports`.

### `scan_repository`

```json
{ "path": "/Users/me/code/my-project", "group_depth": 2 }
```

```json
{
  "repo_id": 1, "files_scanned": 306, "files_skipped": 695,
  "total_loc": 83992, "node_count": 27, "edge_count": 92,
  "languages": [{ "language": "javascript", "files": 292 }],
  "entry_points": ["src/terminal", "src/local-service"],
  "heaviest": [{ "from": "test", "to": "src/core", "imports": 52 }]
}
```

`group_depth` is the dial that decides whether the diagram explains the system
or drowns in it. Depth 2 turns `src/core/agent-loop.mjs` into the box `src/core`.
Depth 1 collapses everything under `src` into one box; depth 3 splits it further.

### `get_architecture`

```json
{ "repo_id": 1, "top_edges": 25, "top_externals": 15 }
```

Returns `layers`, `boxes` (with `fan_in`, `fan_out`, and a `role` of
`foundation` / `top-level` / `internal`), `entry_points`, `foundations`,
`heaviest_dependencies`, and `external_dependencies`.

A **foundation** is a box that three or more things import and which imports two
or fewer itself — the layer the system rests on. A **top-level** box imports
three or more and is imported by nobody.

### `annotate_architecture`

```json
{
  "repo_id": 1,
  "nodes": [
    { "node_key": "src/core", "label": "Agent Runtime", "kind": "service",
      "layer": "Runtime", "detail": "the agent loop and its tool execution" },
    { "node_key": "src/mcp", "label": "MCP Transports", "kind": "adapter",
      "layer": "Extensibility" }
  ]
}
```

Kinds: `entry`, `service`, `module`, `store`, `model`, `adapter`, `ui`, `util`,
`external` — each with its own colour. Only the fields you pass are changed, so
you can name a box now and decide its layer later. Layer order follows first
appearance, so the first layer you name ends up on the left.

### `export_diagram`

```json
{ "repo_id": 1, "format": "markdown", "min_weight": 2 }
```

- **`excalidraw`** — a real `.excalidraw` document. Every element carries the
  full field set Excalidraw requires, so it loads as a valid file.
- **`mermaid`** — text, renders on GitHub, lives in a README.
- **`markdown`** — the onboarding spec: entry points, the embedded diagram, a box
  inventory, the heaviest dependencies and the external package list.
- **`json`** — the raw scene, which is what the panel draws.

`min_weight` drops thin edges. A diagram of everything is a diagram of nothing;
this is the dial for de-cluttering a busy graph.

## What it understands

JavaScript/TypeScript (including `.jsx`/`.tsx`, `require`, dynamic `import()`),
Python, Go, Ruby, Rust, Java/Kotlin/Scala, PHP, Vue, Svelte, plus shell, SQL,
C/C++, C#, Swift, Elixir and Lua for file counting.

Standard-library imports are excluded from the dependency inventory — `os`,
`sys`, `urllib.parse` and `node:fs` are not dependencies anyone chose, and
listing them buries the ones that were.

Skipped by default: `.git`, `node_modules`, `dist`, `build`, `target`, virtualenvs,
caches, `vendor`, `coverage`, and similar. Add more with `exclude`.

## Honest limitations

- **Import parsing is regex-based, not a compiler.** It is line-anchored where
  imports are line-based, so it does not invent edges from prose, but a language
  with unusual syntax may be under-read. The graph is a good architectural
  signal, not a build graph.
- **Python modules resolved by `sys.path` are treated as external.** A local
  package imported by a name that is not repo-relative (for example a harness
  module) can appear in the external list. The fix is a `group_depth` or an
  `exclude`, not a claim that it is a dependency.
- **`kind` and `is_entry` start as heuristics** — a folder containing `main.*`,
  `index.*`, `cli.*` or a `package.json` `bin` entry is guessed to be an entry
  point. Annotate to correct it; the guess is never silent, it is in a column
  you can overwrite.
- **Scans are synchronous.** There is no background job. A very large tree will
  block the tool call; use `max_files`, `exclude`, or a higher `group_depth` to
  bound it.

## State

Declared in `plugin.yaml`: `repos`, `nodes`, `edges`, `exports`.

- `repos` — one row per scanned repository, with file, line and language counts.
- `nodes` — one row per box: the scanner's numbers *and* the agent's labels.
- `edges` — the dependency edges, weighted by import count.
- `exports` — a record of every render, so a spec document can be traced to the
  graph that produced it.

`context_always` injects only `board_state` (six numbers) and the last three
`board_log` events — never a node or a line of source. Re-scanning replaces a
repository's graph rather than appending, because a stale box from a deleted
folder is worse than no box: the diagram would claim a component that no longer
exists.

## Workspace panel

`Excalidraw Spec` renders as a central-panel tab: the board (drawn from the same
scene the exporter emits), the box table with fan-in/fan-out, the heaviest
dependencies, and export buttons for all four formats. It reloads on
`plugin_state_changed` — both the precise event for this plugin and the coarse
`{kind: '*'}` pulse — so scanning from the chat repaints the panel.

## Selftest

```bash
node plugins/excalidraw-spec/selftest.mjs
```

Runs the parsers, graph builder, layout and scene emitter directly, then drives
the whole pipeline against a **real temporary repository on disk** and a
`:memory:` catalog. Covers quoted/commented import detection, resolution and
index fallback, cycle-safe levelling, layout determinism, Excalidraw schema
completeness, byte-level export determinism, rescan replacement, annotation
validation, and every error path. The plugin never imports the CLI.

## Security

No credentials, no network access, no remote code. The scanner reads files and
counts; identifiers never reach SQL as anything but literals from the manifest,
and every query binds its values.
