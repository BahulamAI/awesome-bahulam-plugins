# manim-studio config

Subagent prompts and reference documentation shared by both substrates
of manim-studio (OSS CLI plugin + hosted SaaS Video Studio at
`bahulam.ai/video`).

`config/agents/*.yaml` is the source of truth for the director and
sub-agent prompts. `plugin.yaml` references this folder through
`config.agents_from`; it does not duplicate the prompts inline.
The remaining files under `config/` are grouped as reference prose and
schemas that agents and tools reference:

| File | Purpose | Consumed by |
|---|---|---|
| `reference/scene-rules.md` | Manim CE writing rules (imports, class shape, forbidden patterns, quality tiers) | animator prompt (referenced) |
| `reference/assets-convention.md` | Layout of the shared `assets/` folder (colors, fonts, helpers, templates) | animator + reviewer prompts (referenced) |
| `manifest.schema.json` | JSON Schema for `renders/<slug>/manifest.json` | tool implementations validate against this |
| `agents/*.yaml` | Director, planner, animator, and reviewer prompts | CLI + SaaS agent loaders |

## Tool ownership

Agent `tools:` arrays are allowlists. Manim-specific tools live in the
plugin root `tools/` directory:

- `render_scene` → `tools/render-scene.mjs`
- `register_render` → `tools/register-render.mjs`
- `list_renders` → `tools/list-renders.mjs`

Runtime/meta tools are provided by the host, not by this plugin:
`delegate`, `read_file`, `ls`, `shell`, and `job_output`.

## The 3-way parity story

```
authored here (plugin.yaml + config/agents/)
        │
        ├── bahulam install manim-studio
        │      copies whole plugin dir to ~/.bahulam/plugins/manim-studio/
        │      → CLI loads plugin.yaml and expands config.agents_from
        │
        └── codekepler-backend vendors this repo as git submodule
               at vendor/awesome-bahulam-plugins/
               → SaaS workspace configs mirror the config/agents agent
                 sections; CI parity check fails the build on drift
```

So there's exactly ONE agent-prompt source: `config/agents/*.yaml`.
Both the CLI runtime and the SaaS runtime derive from it. `plugin.yaml`
only declares executable tools, workspace views, and the agent folder.

For plugin authoring, keep executable declarations in the top-level
`config` block. Manim Studio keeps subagents in `config/agents/*.yaml`
and exposes them through `config.agents_from`.

## Sync obligation

- **Agents / prompts**: edit `config/agents/*.yaml`, that's it.
  `bahulam install` ships the new version to CLI users on next release.
  SaaS bumps the submodule pin + syncs the mirror; the parity check
  catches misses.
- **Scene rules / assets convention / manifest schema**: edit files
  under `config/`. Reference docs — no runtime dependency, but both
  substrates cite them so keep them accurate.
