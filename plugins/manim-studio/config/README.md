# manim-studio config

Reference documentation shared by both substrates of manim-studio (OSS
CLI plugin + hosted SaaS Video Studio at `bahulam.ai/video`).

**Not** the source of truth for agent prompts — those live inline in
`plugin.yaml` (this repo) and mirror into the SaaS workspace configs.
Everything under `config/` is prose that agents/tools reference:

| File | Purpose | Consumed by |
|---|---|---|
| `scene-rules.md` | Manim CE writing rules (imports, class shape, forbidden patterns, quality tiers) | animator prompt (referenced) |
| `assets-convention.md` | Layout of the shared `assets/` folder (colors, fonts, helpers, templates) | animator + reviewer prompts (referenced) |
| `manifest.schema.json` | JSON Schema for `renders/<slug>/manifest.json` | tool implementations validate against this |
| `tools/render-scene.tool.yaml` | Canonical tool contract (name, params, return shape) | OSS + SaaS tool impls implement this |

## The 3-way parity story

```
authored here (plugin.yaml + config/)
        │
        ├── bahulam install manim-studio
        │      copies whole plugin dir to ~/.bahulam/plugins/manim-studio/
        │      → CLI loads plugin.yaml verbatim (same file, same content)
        │
        └── codekepler-backend vendors this repo as git submodule
               at vendor/awesome-bahulam-plugins/
               → SaaS workspace configs mirror the plugin.yaml agent
                 sections; CI parity check fails the build on drift
```

So there's exactly ONE agent-prompt source: `plugin.yaml`. Both the
CLI runtime and the SaaS runtime derive from it. `config/` holds prose
references + tool contracts that both substrates read but don't
substitute into the prompt.

## Sync obligation

- **Agents / prompts**: edit `plugin.yaml`, that's it. `bahulam install`
  ships the new version to CLI users on next release. SaaS bumps the
  submodule pin + syncs the mirror; the parity check catches misses.
- **Scene rules / assets convention / manifest schema / tool contract**:
  edit files under `config/`. Reference docs — no runtime dependency,
  but both substrates cite them so keep them accurate.
