# threejs-studio

Text-to-3D interactive scene studio. Describe a concept; the **developer** agent writes a complete self-contained HTML scene using [Three.js](https://threejs.org/) (loaded from CDN). Unlike manim-studio (which requires Python + ffmpeg for video rendering), the output is a `.html` file you open in any browser **instantly** — no render pipeline, no CLI tooling.

Supports: 3D product demos, data visualizations, architectural walkthroughs, physics simulations, generative art, educational animations, interactive configurators, and more.

## Prerequisites

- Node.js (implicit from the CLI runtime)
- A modern web browser (Chrome, Firefox, Safari, Edge) to view output

No Python, no manim, no ffmpeg. Three.js loads from CDN at runtime.

## Quick start

```bash
# From the awesome-bahulam-plugins repo root
node plugins/threejs-studio/selftest.mjs
```

## Architecture

```
User brief → Scene Director → [Planner for complex scenes] → Developer → Reviewer → Done
```

Three agents:

| Agent | Role | File |
|-------|------|------|
| **Scene Director** | Orchestrator — talks to the user, drives the pipeline | `config/workspace.yaml` |
| **Scene Planner** | Designs the scene breakdown + feature list (read-only) | `config/agents/plan.yaml` |
| **Developer** | Writes the complete Three.js HTML scene | `config/agents/developer.yaml` |
| **Scene Reviewer** | Verifies output HTML is valid and matches the brief | `config/agents/reviewer.yaml` |

Unlike manim-studio:
- No background render — output is instant HTML
- No `render-reviewer` waking on job completion — reviewer is called directly
- No quality tiers (l/m/h) — instead, complexity levels (simple/intermediate/complex)
- No clip-splitting/stitching — one scene = one HTML file

## How it exercises the platform

| Feature | Where |
|---------|-------|
| Sub-agent delegation | Director delegates to planner → developer → reviewer |
| Durable approval gate | `render_approval_record` persists approved/rejected/changed before coding |
| Durable plugin state | `threejs_scenes`, `threejs_approvals`, `threejs_jobs` tables |
| Reactive canvas | Gallery re-renders on `plugin_state_changed` |
| Self-healing pipeline | Reviewer fixes trivial HTML issues directly, delegates to developer for complex fixes |
| Evidence handoff | `render_report` returns scene info, approvals, status |

## Plugin source layout

```
plugins/threejs-studio/
├── plugin.yaml                  # tool declarations, state schema, agent paths
├── tools/
│   ├── write-threejs-scene.mjs  # core tool — writes self-contained HTML
│   ├── register-render.mjs      # records scene outcomes
│   ├── list-renders.mjs         # scene history
│   ├── render-approval-record.mjs
│   ├── render-report.mjs
│   └── lib.mjs
├── config/
│   ├── workspace.yaml           # Scene Director (entry agent)
│   ├── agents/                  # planner, developer, reviewer
│   │   ├── plan.yaml
│   │   ├── developer.yaml
│   │   └── reviewer.yaml
│   └── reference/
│       └── scene-rules.md       # Three.js capabilities & best practices
├── workspace/
│   └── studio.html              # live scene gallery panel
├── selftest.mjs
└── README.md
```

## Tool ownership

| Tool | Owner |
|------|-------|
| `write_threejs_scene` | plugin-local: `tools/write-threejs-scene.mjs` |
| `register_render` | plugin-local: `tools/register-render.mjs` |
| `list_renders` | plugin-local: `tools/list-renders.mjs` |
| `render_approval_record` | plugin-local: `tools/render-approval-record.mjs` |
| `render_report` | plugin-local: `tools/render-report.mjs` |
| `delegate` | platform meta-tool |
| `read_file` | platform filesystem tool |
| `list_files` | platform filesystem tool |

## Scene gallery

After scenes are created, the workspace panel (`workspace/studio.html`) shows a live-updating table of scenes with status, slug, title, path, and creation time. Click "open" to view a scene in your browser.