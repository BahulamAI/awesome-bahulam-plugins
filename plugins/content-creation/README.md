# content-creation

Multi-agent content runtime for copy, image, video, Three.js, and Manim assets.

Content creation runtime. Describe a campaign, explainer, product demo, or educational concept; the **content director** creates a brief, routes copy/image/video/Three.js/Manim work to specialist agents, records artifacts, and keeps a live gallery of outcomes. Manim remains one rendering substrate for technical explainers.

## Prerequisites

```bash
python3 --version          # 3.9+
pip install manim          # Manim Community Edition
ffmpeg -version            # bundled with manim on most installs
```

Verify with `node plugins/content-creation/selftest.mjs` (prereqs are probed,
tool logic is tested offline).

## Install & try

```bash
bahulam install content-creation            # via registry (this repo, subdir: plugins/content-creation)
bahulam install bahulam:content-creation    # explicit prefix, same result
bahulam plugin content-creation .           # opens the studio workspace
```

Then, from the workspace chat or any REPL where the plugin is enabled:

```
> Create a content package for Bahulam plugins: one X post, one LinkedIn post,
  one image brief, one Three.js product scene, and a 20-second Manim explainer.
```

Or call a substrate specialist directly:

```
> /run threejs-developer Create an interactive product scene for Bahulam plugins
> /run image-artist Create a launch image asset for the same package
> /run animator Create a 20-second animation explaining compound interest
```

Watch the terminal (two animator lanes, background job ids, the reviewer
waking per completion) and the Content Creation panel (each asset appears
the moment it finishes). Everything lands under
`.bahulam/tmp/content-creation/` in a structured tree — see below.

## Files each content package creates

```
.bahulam/tmp/content-creation/
├── packages/<slug>/                   ← content package briefs
│   └── brief.json
├── threejs/<slug>/                    ← interactive HTML scenes
│   └── index.html
├── assets/                            ← curated, shared across renders (opt-in)
│   ├── colors.py                        BRAND_BLUE, BG_DARK, ACCENT, …
│   ├── fonts.yaml                       font families the animator may use
│   ├── helpers/                         reusable animation utilities
│   └── templates/                       reusable Scene base classes
└── renders/<slug>/                    ← one folder per rendered scene
    ├── scene.py                         the Manim CE source
    ├── script.md                        approved storyboard (when provided)
    ├── manifest.json                    {slug, class, quality, render_command,
    │                                     expected_video, created_at, status}
    └── videos/<slug>/<res>/<Class>.mp4  manim's rendered output
```

The `assets/` folder is optional. The animator agent checks it before every
scene and reuses whatever's there (colors, fonts, helper classes) so
successive renders in the same project stay visually consistent. If the
animator invents a helper that the next scene will also need, it writes it
back into `assets/helpers/` so future runs pick it up automatically. This
keeps each `scene.py` focused on the story instead of restating brand
constants + boilerplate every time.

## How it exercises the platform

| Feature | Where |
|---|---|
| Content package state | `content_brief`, `record_asset`, `list_assets` |
| Three.js artifacts | `write_threejs_scene` writes inspectable HTML scenes |
| Image/video substrate | specialist agents call platform generation tools and record outputs |
| Background jobs + wake-on-finish | `shell run_in_background` + `on_complete_agent: render-reviewer` |
| Parallel sub-agents | multiple scenes → `animator#1` / `animator#2` lanes |
| Shared blackboard | `renders` / `scenes` streams; gallery lists from them |
| Reactive canvas (cross-process) | gallery re-renders on `plugin_state_changed`, including the coarse `kind:'*'` pulse when the agent ran in the terminal |
| Self-healing Manim pipeline | reviewer reads the failed job log tail, patches the scene, re-renders |

## Plugin source layout

```
plugins/content-creation/
├── plugin.yaml                # tool, entry-agent path, subagent path, view declarations
├── tools/
│   ├── content-brief.mjs      # creates a package brief
│   ├── record-asset.mjs       # records image/video/copy/report assets
│   ├── write-threejs-scene.mjs # writes interactive Three.js HTML
│   ├── list-assets.mjs        # reads the full artifact gallery
│   ├── render-scene.mjs       # writes render folder + returns render command
│   ├── register-render.mjs    # blackboard write the gallery listens to
│   └── list-renders.mjs       # history for agent + humans
├── workspace/
│   └── studio.html            # live content artifact gallery panel
├── config/                    # subagents + reference docs
│   ├── workspace.yaml         # primary/entry agent (content director)
│   ├── agents/                # copy, image, video, threejs, planner, animator, reviewer
│   ├── reference/             # Manim rules and asset conventions
│   │   ├── scene-rules.md
│   │   └── assets-convention.md
│   ├── manifest.schema.json   # per-render manifest.json shape
├── selftest.mjs
└── README.md
```

## How the CLI consumes this (codekepler-npm)

`bahulam install content-creation` copies the whole plugin folder to
`~/.bahulam/plugins/content-creation/` on the user's machine — including
`config/`. From there:

1. **`plugin.yaml`** — the CLI's `PluginRegistry.scan()` parses this
   file to learn about tools, the entry agent path, subagent path, and
   workspace panel. Its `config` block points `workspace` at
   `config/workspace.yaml` and `agents_from` at `config/agents/`.
2. **`config/workspace.yaml`** — the source of truth for the primary
   director agent, matching the SaaS workspace convention.
3. **`config/agents/*.yaml`** — delegated subagent prompts. npm expands
   these into the runtime agent list; backend and marketplace consumers
   can read the same files from the plugin package.
4. **`tools/*.mjs`** — the CLI's tool executor loads these dynamically
   when the agent calls `content_brief`, `record_asset`,
   `write_threejs_scene`, `render_scene`, `register_render`,
   `list_assets`, or `list_renders`.

## Tool Ownership

Subagent `tools:` entries are a mixed allowlist:

| Tool | Owner |
|---|---|
| `render_scene` | plugin-local: `tools/render-scene.mjs` |
| `register_render` | plugin-local: `tools/register-render.mjs` |
| `list_renders` | plugin-local: `tools/list-renders.mjs` |
| `content_brief` | plugin-local: `tools/content-brief.mjs` |
| `record_asset` | plugin-local: `tools/record-asset.mjs` |
| `write_threejs_scene` | plugin-local: `tools/write-threejs-scene.mjs` |
| `list_assets` | plugin-local: `tools/list-assets.mjs` |
| `delegate` | platform meta-tool |
| `read_file` | platform filesystem tool |
| `generate_image` | platform media generation tool |
| `analyze_image` | platform vision/review tool |
| `shell` | platform shell tool |
| `job_output` | platform background-job tool |

Domain tools that define Content Creation behavior should live under
`tools/`. Platform/meta tools stay in the runtime and are only named in
agent allowlists.

The SaaS Content Creation runtime should consume this same plugin contract via
MCP/Context Forge or an isolated hosted adapter. Manim, image generation, video
generation, and Three.js may run on different substrates, but the manifest,
prompts, tool names, state model, and handoff contract should stay shared.
See `config/README.md`.

**Bottom line**: `plugin.yaml` is the executable manifest all consumers
can read directly. npm uses the top-level `config` contract for tools,
entry-agent references, subagent references, and view declarations.
Content Creation keeps the director in `config/workspace.yaml`, keeps
delegated subagents in `config/agents/*.yaml`, and references them with
`config.workspace` plus `config.agents_from`.
