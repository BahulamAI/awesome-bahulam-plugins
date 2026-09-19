# threejs-studio

Compositional Three.js content-creation studio. Scenes live as a JSON DSL
(`scene.json`) and are compiled to a self-contained HTML document on every
mutation. Domain specialists — **layout**, **material**, **lighting**,
**camera** — each own a slice of the DSL. A **Scene Director** talks to the
user and delegates each domain in turn.

Supports: 3D product demos & configurators, data visualizations, architectural
walkthroughs, physics simulations, generative art, educational animations,
interactive experiences, and MP4 video export.

## Prerequisites

- Node.js (implicit from the CLI runtime).
- A modern browser to view scenes.
- Optional: `ffmpeg` + Chromium (via `puppeteer`) for MP4 export.

Three.js loads from CDN at view time — no bundler, no build step.

## Quick start

```bash
# From the awesome-bahulam-plugins repo root
node plugins/threejs-studio/selftest.mjs
```

## Architecture — 4 layers

```
┌───────────────────────────────────────────────────────────────────┐
│ 1. Scene layer      scene.json (DSL)  — nodes/materials/camera... │
├───────────────────────────────────────────────────────────────────┤
│ 2. Rendering layer  compile(scene) → index.html (Three.js WebGL)  │
├───────────────────────────────────────────────────────────────────┤
│ 3. Authoring layer  create_node, assign_material, add_light, ...  │
│                     (25 tools; each mutates DSL and recompiles)   │
├───────────────────────────────────────────────────────────────────┤
│ 4. Persistence      SQLite (state.db) + snapshots/ + assets/      │
└───────────────────────────────────────────────────────────────────┘
```

### Scene folder layout

```
<cwd>/<slug>/
├── scene.json       # DSL — source of truth
├── index.html       # regenerated on every mutation
├── assets/          # imported meshes, textures, HDRI
└── snapshots/       # timestamped scene.json copies
```

## Agent topology

```
                    ┌─ Scene Director (interactive) ─┐
                    │                                 │
                    ▼                                 ▼
                Planner                         Developer (fallback,
             (read-only)                         one-shot raw HTML)
                    │
       ┌───┬───┬────┼────┬────┬───┬──────┐
       ▼   ▼   ▼    ▼    ▼    ▼   ▼      ▼
    Asset Layout Mat Light Cam Anim  Behavior
       │   │   │    │    │    │    │
       └───┴───┴────┴────┴────┴────┘
                    ▼
                 Critic (VLM verdict) ──► Reviewer (HTML validity)
                    ▼
                 Renderer (MP4 export via headless Chromium + ffmpeg)
```

| Agent | Role | Owns | File |
|-------|------|------|------|
| **Scene Director** | Orchestrator, user-facing | nothing directly | `config/workspace.yaml` |
| **Plan** | Scene breakdown, feature list (read-only) | — | `config/agents/plan.yaml` |
| **Asset** | Mesh/texture generation, glTF/HDRI import | `assets.*`, `nodes[].{type:gltf}` | `config/agents/asset.yaml` |
| **Layout** | Nodes, hierarchy, transforms | `nodes[].{type,geometry,parent,position,...}` | `config/agents/layout.yaml` |
| **Material** | PBR materials, textures | `materials.*`, `nodes[].materialId` | `config/agents/material.yaml` |
| **Lighting** | Lights, HDRI, exposure | `nodes[]{type:light}`, `background`, `tone` | `config/agents/lighting.yaml` |
| **Camera** | Camera type, framing, controls | `camera.*` | `config/agents/camera.yaml` |
| **Animation** | Keyframes + procedural motion | `animations[]`, tick `scripts[]` | `config/agents/animation.yaml` |
| **Behavior** | Physics + interaction scripts | `physics[]`, `scripts[]` | `config/agents/behavior.yaml` |
| **Critic** | Screenshots + VLM critique (read-only) | — | `config/agents/critic.yaml` |
| **Developer** | One-shot raw HTML (fallback) | writes `index.html` directly | `config/agents/developer.yaml` |
| **Reviewer** | Validates HTML, fixes trivial issues | `index.html` last-mile | `config/agents/reviewer.yaml` |
| **Renderer** | MP4 export via headless Chromium + ffmpeg | video file only | `config/agents/renderer.yaml` |

See [`config/reference/agent-contracts.md`](./config/reference/agent-contracts.md)
for the full ownership matrix and handoff format.

See [`config/reference/scene-dsl.md`](./config/reference/scene-dsl.md) for
the DSL spec (top-level shape, node types, geometry types, material types,
lights, scripts).

## Tools by domain

**Scene lifecycle**
- `create_scene` — initialize a scene folder with defaults.
- `get_scene` — compact summary of the DSL (call at start of every turn).
- `snapshot_scene` — timestamped copy before large edits.

**Layout Agent**
- `create_node`, `set_transform`, `reparent_node`, `delete_node`,
  `align_nodes`, `measure_bounds`.

**Material Agent**
- `create_material`, `set_material_property`, `assign_material`.

**Lighting Agent**
- `add_light`, `set_environment` (HDRI or color), `set_exposure`.

**Camera Agent**
- `set_camera`, `frame_scene` (auto-fit to bounds).

**Asset Agent**
- `generate_mesh` — text→3D via configured provider (env `THREEJS_MESH_PROVIDER=meshy|local`).
- `generate_texture` — text→image (env `THREEJS_TEXTURE_PROVIDER=fal|local`).
- `import_gltf` — download/copy a `.glb`/`.gltf` into `assets/`.
- `search_asset_library` — curated Poly Haven / Khronos catalog.
- `decimate_mesh` — record decimation intent (real reduction: Phase 3).
- `list_assets` — read the manifest.

**Behavior Agent**
- `add_physics_body` — cannon-es rigid bodies (`box`/`sphere`/`plane`).
- `add_script` — raw JS on `tick`/`click`/`hover` events.
- `wire_event` — shortcut for common actions (`toggle_visible`, `swap_material`, `translate`, `rotate`, `log`).

**Animation Agent**
- `add_keyframe` — build `THREE.AnimationClip` keyframe by keyframe.
- `add_procedural_motion` — `spin`/`orbit`/`oscillate`/`bob` via tick script.

**Critic Agent**
- `render_screenshot` — puppeteer captures N camera angles. Degrades to plan-only when puppeteer is missing.
- `evaluate_scene` — VLM verdict via configured provider (env `THREEJS_VLM_PROVIDER=anthropic|local`).

**One-shot fallback**
- `write_threejs_scene` — write raw HTML from a JS snippet. Bypasses the
  DSL. Use only for custom shaders, custom physics loops, or anything
  where the DSL is a straitjacket. **Warning:** subsequent DSL mutations
  will *overwrite* index.html.

**Review + records**
- `register_render`, `list_renders`, `render_approval_record`, `render_report`.

**Video**
- `render_threejs_video` — returns a `render_command` to launch as a
  background shell job; the `renderer` agent wakes on completion.

## How it exercises the platform

| Feature | Where |
|---------|-------|
| Sub-agent delegation | Director → layout → material → lighting → camera → reviewer |
| Durable approval gate | `render_approval_record` before compositional work starts |
| Durable plugin state | `threejs_scenes`, `threejs_approvals`, `threejs_jobs` (SQLite in `~/.bahulam/data/threejs-studio/state.db`) |
| Reactive canvas | Gallery re-renders on `plugin_state_changed` |
| Versioning | `snapshots/` under each scene folder |
| Self-healing | Reviewer fixes trivial HTML; else delegates back |
| Evidence handoff | `render_report` returns scene info, approvals, status |

## Plugin source layout

```
plugins/threejs-studio/
├── plugin.yaml
├── tools/
│   ├── lib.mjs                       # DSL helpers + state
│   ├── scene-compile.mjs             # DSL → HTML compiler
│   ├── scene-io.mjs                  # loadOrCreate / saveAndSync
│   ├── create-scene.mjs / get-scene.mjs / snapshot-scene.mjs
│   ├── create-node.mjs / set-transform.mjs / reparent-node.mjs
│   ├── delete-node.mjs / align-nodes.mjs / measure-bounds.mjs
│   ├── create-material.mjs / set-material-property.mjs / assign-material.mjs
│   ├── add-light.mjs / set-environment.mjs / set-exposure.mjs
│   ├── set-camera.mjs / frame-scene.mjs
│   ├── generate-mesh.mjs / generate-texture.mjs / import-gltf.mjs
│   ├── search-asset-library.mjs / decimate-mesh.mjs / list-assets.mjs
│   ├── add-physics-body.mjs / add-script.mjs / wire-event.mjs
│   ├── add-keyframe.mjs / add-procedural-motion.mjs
│   ├── render-screenshot.mjs / evaluate-scene.mjs
│   ├── write-threejs-scene.mjs       # Fallback (raw HTML)
│   ├── register-render.mjs / list-renders.mjs
│   ├── render-approval-record.mjs / render-report.mjs
│   ├── render-threejs-video.mjs      # MP4 export
│   └── providers/                    # mesh / texture / vlm adapters (local + real)
├── config/
│   ├── workspace.yaml                # Scene Director
│   ├── agents/                       # asset / layout / material / lighting / camera / animation / behavior / critic / plan / developer / reviewer / renderer
│   └── reference/                    # scene-dsl.md + agent-contracts.md + scene-rules.md
├── workspace/
│   ├── studio.html                   # gallery panel
│   └── viewport.html                 # live iframe of selected scene
├── selftest.mjs                      # 40+ assertions covering every tool
└── README.md
```

## Example brief → run

```
User: "Make a red leather chair on a wood floor, warm afternoon light"

1. Director  → plan            : produce breakdown
   Director  → user            : "here's the plan, approve?"
   Director  → render_approval_record(approved)

2. Director  → create_scene(name="lounge", 1024x720)
   Director  → layout          : add floor + chair mesh nodes
   Director  → material        : create wood_oak + leather_red, assign
   Director  → lighting        : three-point warm rig, ACESFilmic
   Director  → camera          : frame_scene(padding: 1.5, azimuth: 25)
   Director  → reviewer        : validates HTML → register_render(completed)

3. Director  → user            : cites <cwd>/lounge/index.html, offers video
```

Every intermediate `scene.json` is versioned in `<cwd>/lounge/snapshots/` so
you can revert to any prior state.

## Provider configuration

All Phase 2 tools work with **zero credentials** — local stubs write real
files (placeholder .gltf, solid-color PNG, heuristic critique). Upgrade
to real providers via env vars:

```bash
# Mesh generation
export THREEJS_MESH_PROVIDER=meshy
export MESHY_API_KEY=...

# Texture generation
export THREEJS_TEXTURE_PROVIDER=fal
export FAL_KEY=...

# VLM critic
export THREEJS_VLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=...
export THREEJS_VLM_MODEL=claude-sonnet-4-6   # optional override
```

Tools accept `provider: "..."` in args to override per call.

## Panels

Two workspace views ship with the plugin:

| Panel | Purpose |
|-------|---------|
| `Three.js Studio` (`workspace/studio.html`) | Scene gallery — list, status, paths, open in browser. |
| `Viewport` (`workspace/viewport.html`) | Live iframe of the selected scene's `index.html` with a scene picker + refresh. |

## Roadmap — Phase 3

- **Real mesh decimation** — apply `gltf-transform` in a background job
  when `decimation.status === 'pending'`.
- **Live Poly Haven / Sketchfab search** — replace curated catalog with API.
- **Additional providers** — Rodin, Tripo, Stability, OpenAI vision.
- **Shader Agent** — safe ShaderMaterial authoring with uniform bindings.
- **Timeline panel** — visualize + edit animations from `scene.json`.
- **Scene diffing** — inspect changes between snapshots side-by-side.

## Migration from v0.1.0

The old `write_threejs_scene` tool still exists as a fallback. New scenes
should prefer `create_scene` + compositional specialists. Existing scenes
built with `write_threejs_scene` remain readable but cannot be mutated
incrementally (their HTML has no corresponding scene.json).
