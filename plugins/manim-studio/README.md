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
bahulam plugin install manim-studio     # once merged into the registry
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
the moment it finishes). Videos land under `.bahulam/tmp/manim/media/`.

## How it exercises the platform

| Feature | Where |
|---|---|
| Background jobs + wake-on-finish | `shell run_in_background` + `on_complete_agent: render-reviewer` |
| Parallel sub-agents | multiple scenes → `animator#1` / `animator#2` lanes |
| Shared blackboard | `renders` / `scenes` streams; gallery lists from them |
| Reactive canvas (cross-process) | gallery re-renders on `plugin_state_changed`, including the coarse `kind:'*'` pulse when the agent ran in the terminal |
| Self-healing pipeline | reviewer reads the failed job's log tail, patches the scene, re-renders |

## Layout

```
plugins/manim-studio/
├── plugin.yaml
├── tools/
│   ├── save-scene.mjs        # writes scene .py, returns the render command
│   ├── register-render.mjs   # blackboard write the gallery listens to
│   └── list-renders.mjs      # history for agent + humans
├── workspace/
│   └── studio.html           # live render gallery
├── selftest.mjs
└── README.md
```
