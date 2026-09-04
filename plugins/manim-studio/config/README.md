# manim-studio config

Canonical source of truth for content shared between this OSS plugin
(local CLI substrate) and Bahulam's hosted Video Studio product
(`bahulam.ai/video`, cloud substrate). Everything under `config/` MUST
be identical in both places at deploy time.

Substrate-specific implementation lives outside `config/`:
- OSS `plugins/manim-studio/tools/*.mjs` — local `manim` subprocess
- SaaS `codekepler-backend/app/workspaces/video_studio/*.py` — HTTPS
  POST to a Django render service

Both implementations honor the same tool contract, produce the same
manifest shape, and get the same agent prompts. Where they differ is
strictly the execution substrate + storage endpoint.

## Contents

| File | Consumed by | Purpose |
|---|---|---|
| `scene-rules.md` | animator prompt | Manim CE writing rules (imports, class shape, forbidden patterns, quality tiers) |
| `assets-convention.md` | animator + reviewer prompts | Layout of the shared `assets/` folder (colors, fonts, helpers, templates) |
| `manifest.schema.json` | tool implementations | JSON Schema for the per-render `manifest.json` |
| `tools/render-scene.tool.yaml` | tool implementations | Canonical tool contract (name, params, return shape) |
| `prompts/animator.system.md` | animator prompt | Substrate-agnostic system prompt fragment |
| `prompts/reviewer.system.md` | reviewer prompt | Substrate-agnostic reviewer prompt |

## Sync obligation

- OSS side: this repo IS the source. Editing files under `config/` is
  a normal PR.
- SaaS side: `codekepler-backend` vendors this repo as a git submodule
  at `vendor/awesome-bahulam-plugins/`. A CI job diffs the SaaS
  animator/reviewer prompts against `config/prompts/*.md` and fails the
  build if they drift. Update the submodule pin to pull in changes.
