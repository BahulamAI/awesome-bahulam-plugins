# manim-studio

Text-to-video animation studio. Describe a concept; the **animator** agent
writes a [Manim CE](https://www.manim.community/) scene, launches the render
as a **background job** and keeps working; the **render-reviewer** agent
wakes when ffmpeg finishes — verifying the output or fixing a failed scene
and re-rendering. The workspace gallery updates live as each video lands.

## Prerequisites

```bash
python3 --version          # 3.9+
pip install manim          # Manim Community Edition
ffmpeg -version            # bundled with manim on most installs
```

Verify with `node plugins/manim-studio/selftest.mjs` (prereqs are probed,
tool logic is tested offline).

## Install & try

```bash
bahulam install manim-studio            # via registry (this repo, subdir: plugins/manim-studio)
bahulam install bahulam:manim-studio    # explicit prefix, same result
bahulam plugin manim-studio .           # opens the studio workspace
```

Then, from the workspace chat or any REPL where the plugin is enabled:

```
> /run animator Create a 20-second animation explaining compound interest
```

Or the full showcase — parallel scenes, background renders, self-healing:

```
> Create two short animations: one explaining compound interest, one on
  the Collatz conjecture. Render both in the background, review the
  outputs, and fix anything that fails.
```

Watch the terminal (two animator lanes, background job ids, the reviewer
waking per completion) and the Manim Studio panel (each render appears
the moment it finishes). Everything lands under
`.bahulam/tmp/manim/manim-studio/` in a structured tree — see below.

## Files each render creates

```
.bahulam/tmp/manim/manim-studio/
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
| Background jobs + wake-on-finish | `shell run_in_background` + `on_complete_agent: render-reviewer` |
| Parallel sub-agents | multiple scenes → `animator#1` / `animator#2` lanes |
| Shared blackboard | `renders` / `scenes` streams; gallery lists from them |
| Reactive canvas (cross-process) | gallery re-renders on `plugin_state_changed`, including the coarse `kind:'*'` pulse when the agent ran in the terminal |
| Self-healing pipeline | reviewer reads the failed job's log tail, patches the scene, re-renders |

## Plugin source layout

```
plugins/manim-studio/
├── plugin.yaml                # agent + tool + workspace declarations
├── tools/
│   ├── render-scene.mjs       # writes render folder + returns render command
│   ├── register-render.mjs    # blackboard write the gallery listens to
│   └── list-renders.mjs       # history for agent + humans
├── workspace/
│   └── studio.html            # live render gallery panel
├── config/                    # subagents + reference docs
│   ├── agents/                # director, planner, animator, reviewer
│   ├── reference/             # Manim rules and asset conventions
│   │   ├── scene-rules.md
│   │   └── assets-convention.md
│   ├── manifest.schema.json   # per-render manifest.json shape
├── selftest.mjs
└── README.md
```

## How the CLI consumes this (codekepler-npm)

`bahulam install manim-studio` copies the whole plugin folder to
`~/.bahulam/plugins/manim-studio/` on the user's machine — including
`config/`. From there:

1. **`plugin.yaml`** — the CLI's `PluginRegistry.scan()` parses this
   file to learn about the tools and workspace panel. Its `config`
   block points `agents_from` at `config/agents/`.
2. **`config/agents/*.yaml`** — the source of truth for the director
   and sub-agent prompts. npm expands these into the runtime agent list;
   backend and marketplace consumers can read the same files from the
   plugin package.
3. **`tools/*.mjs`** — the CLI's tool executor loads these dynamically
   when the agent calls `render_scene`, `register_render`, or
   `list_renders`.

## Tool Ownership

Subagent `tools:` entries are a mixed allowlist:

| Tool | Owner |
|---|---|
| `render_scene` | plugin-local: `tools/render-scene.mjs` |
| `register_render` | plugin-local: `tools/register-render.mjs` |
| `list_renders` | plugin-local: `tools/list-renders.mjs` |
| `delegate` | platform meta-tool |
| `read_file` | platform filesystem tool |
| `ls` | platform filesystem tool |
| `shell` | platform shell tool |
| `job_output` | platform background-job tool |

Domain tools that define Manim Studio behavior should live under
`tools/`. Platform/meta tools stay in the runtime and are only named in
agent allowlists.

The SaaS Video Studio (`bahulam.ai/video`) vendors this same repo as a
git submodule under `codekepler-backend/vendor/awesome-bahulam-plugins/`
and CI-diffs its SaaS prompt mirror against `config/agents/*.yaml` to
prevent drift. See `config/README.md`.

**Bottom line**: `plugin.yaml` is the executable manifest all consumers
can read directly. npm uses the top-level `config` contract for tools,
agent references, and workspace declarations. Manim Studio keeps prompts
in `config/agents/*.yaml` and references them with
`config.agents_from`. SaaS mirrors those agent files into its workspace
configs and the parity check catches drift.
