<p align="center">
  <h1 align="center">awesome-bahulam-plugins</h1>
  <p align="center">
    <strong>The community registry of open-source plugins for<br>
    <a href="https://bahulam.ai">Bahulam Code</a></strong>
  </p>
  <p align="center">
    <a href="https://github.com/BahulamAI/awesome-bahulam-plugins/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
    </a>
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform">
    <img src="https://img.shields.io/badge/plugins-6-brightgreen.svg" alt="Plugins">
  </p>
</p>

---

A **plugin** bundles tools, agents, and a live workspace panel into a single directory.

**Hand-authored packs** (this repo) — install by name or from a URL:
  `bahulam install <name>` (or `bahulam install bahulam:<name>` with the
  explicit prefix). Registry entries here point `repository` at this repo
  itself with a `subdir` per pack — the community repo IS the source.

**[pi](https://www.npmjs.com/search?q=pi-) ecosystem** — pi packages are first-class
  **ingredients** in the plugin system. `bahulam install pi:<package>` scaffolds a
  normal Bahulam pack with `config.composes` plus `config.workspace`; authored
  plugins can also compose pi packages directly. Use a pi package standalone to
  experiment:
  `bahulam install pi:pi-redmine`

**Plugin = tools + state + workspace + agent** — every authored plugin uses the
  same shape: `plugin.yaml` points at a canonical `config/workspace.yaml` entry
  agent, optional `config/agents/` subagents, optional local tools, and optional
  workspace panels. Pi-scaffolded packs use this same shape.

**Bahulam plugins are the first-class unit.** Use pi packages as ingredients
when they save implementation time, but publish Bahulam plugins when the result
is an outcome runtime: entry agent, orchestration, state, UI, artifacts, and a
clear path to hosted SaaS execution through MCP/Context Forge.

---

## 🚀 Featured Plugins

<div style="display: flex; flex-wrap: wrap; gap: 24px; margin: 24px 0;">

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [browser-use](./plugins/browser-use)
**Browser form-filling runtime** · `browser` `forms` `automation` `approvals`

Help users complete web forms with a visible, approval-gated workflow. The operator creates a session, builds a reusable form profile, plans field fills, records action state, and stops before submit-sensitive actions for explicit approval. Local runtime can bind to Playwright; hosted runtime can expose the same contract through MCP/Context Forge.

- `tools/` — sessions, form profiles, fill plans, action records, reports
- `config/agents/` — form planner and compliance reviewer
- `workspace/` — browser-use action trail and approval model
- `selftest.mjs` — offline form-fill state smoke test

```bash
bahulam install browser-use
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [campaign-studio](./plugins/campaign-studio)
**Campaign outcome runtime** · `marketing` `ads` `state` `orchestration`

Plan, create, approve, cross-post, and track campaigns. The entry agent drives the workflow; helper agents review brand/compliance and analyze results. Tools write durable campaign, variant, post, approval, and metrics state; the workspace dashboard shows the outcome trail.

- `tools/` — campaign creation, variants, approvals, scheduling, metrics, reports
- `config/agents/` — compliance reviewer and growth analyst
- `workspace/` — campaign board and activity dashboard
- `selftest.mjs` — end-to-end outcome smoke test

```bash
bahulam install campaign-studio
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [hello-world](./plugins/hello-world)
**Minimal reference plugin** · `reference` `starter`

The starting point. A small tool set, one entry agent, one workspace panel. Copy it and start building.

- `tools/` — hello, word-count, collatz
- `workspace/` — live panel with interactive buttons
- `selftest.mjs` — smoke-test offline

```bash
bahulam install hello-world
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [hello-mcp](./plugins/hello-mcp)
**MCP + UX reference pattern** · `reference` `mcp` `starter`

Bundles a stdio MCP server, JS state tools, an entry agent that composes both, and a reactive workspace view. The blueprint for wrapping any MCP server as a Bahulam plugin.

- `mcp-server/` — hex-color.mjs (zero-dep stdio server)
- `tools/` — save-palette, list-palettes
- `workspace/` — Palette Studio live UI
- `selftest.mjs` — offline smoke test

```bash
bahulam install hello-mcp
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [content-creation](./plugins/content-creation)
**Multi-agent content runtime** · `showcase` `content` `image` `video` `threejs` `manim`

Describe a campaign, explainer, or product idea → the **content director** creates a brief, routes copy/image/video/Three.js/Manim work to specialist agents, records assets, reviews outputs, and keeps the live gallery current. Manim is one substrate inside the broader content workflow.

- `tools/` — content briefs, asset records, Three.js scenes, Manim renders, gallery reads
- `config/agents/` — copywriter, image artist, video producer, Three.js developer, animator, reviewer
- `workspace/` — live content artifact gallery
- `selftest.mjs` — offline multi-format outcome smoke test

```bash
bahulam install content-creation
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [manim-studio](./plugins/manim-studio)
**Standalone Manim animation studio** · `animation` `video` `manim` `async`

Create focused Manim explainers with a director, animator, render reviewer,
background render jobs, persisted scene folders, and a live render gallery.
This remains the standalone Manim plugin; `content-creation` uses Manim as one
substrate inside a broader content workflow.

- `tools/` — render scenes, register completed renders, list render state
- `config/agents/` — planner, animator, render reviewer
- `workspace/` — Manim render gallery
- `selftest.mjs` — offline render-state smoke test

```bash
bahulam install manim-studio
```

</div>

</div>

---

## ⚡ Quick Install

```bash
# —· Hand-authored packs (this repo) ·—
bahulam install hello-world          # install by registry name
bahulam install ./my-plugin                 # from a local checkout
bahulam install https://github.com/…        # from a git URL

# —· pi ecosystem ·—
bahulam install pi:pi-redmine                # auto-scaffold a full pack from a pi package
bahulam pull pi:pi-web-access                # 🧩 raw ingredient (composable, not directly runnable)
```

Open a workspace to see the live panel:

```bash
bahulam plugin hello-world .
```

Start a new Bahulam-native outcome plugin from the template:

```bash
cp -R templates/outcome-runtime-plugin plugins/my-plugin
```

---

## 🧩 Plugin Architecture

Every Bahulam plugin follows the same contract:

<table>
<tr>
<th>Layer</th>
<th>What it does</th>
<th>Example</th>
</tr>
<tr>
<td><strong>Tools</strong></td>
<td><code>.mjs</code> modules the agent calls</td>
<td><code>save-scene.mjs</code>, <code>hello.mjs</code></td>
</tr>
<tr>
<td><strong>Sub-agents</strong></td>
<td>Specialists that compose tools</td>
<td><code>animator</code>, <code>render-reviewer</code></td>
</tr>
<tr>
<td><strong>Workspace</strong></td>
<td>Live HTML panels bound to state</td>
<td><code>studio.html</code>, <code>index.html</code></td>
</tr>
<tr>
<td><strong>Shared Blackboard</strong></td>
<td>Cross-process state that agents and panels read/write</td>
<td>render gallery, issue snapshots</td>
</tr>
<tr>
<td><strong>MCP servers</strong></td>
<td>Bundled stdio or remote servers</td>
<td><code>hex-color.mjs</code></td>
</tr>
<tr>
<td><strong>Pi ingredients</strong></td>
<td>Composed <code>pi:*</code> packages from npm — tools become plugin tools via <code>config.composes</code></td>
<td><code>pi-redmine</code> (11 tools), <code>pi-web-access</code> (4 tools)</td>
</tr>
</table>

Plugins are composable: an authored pack can depend on pi ingredients with
`config.composes`, and `bahulam install pi:<package>` generates the same pack
shape automatically. See the [Plugin Authoring Guide](https://docs.bahulam.ai/plugins)
for the full contract.

## Authoring Templates

- [`templates/outcome-runtime-plugin`](./templates/outcome-runtime-plugin) —
  the minimum Bahulam-native skeleton for a plugin with an entry agent, helper
  agent, tools, state, live workspace panel, and offline selftest.

Templates are not listed in `registry.json`; they are copied into `plugins/` or
an external plugin repository before publication.

---

## 📋 Registry

The `registry.json` at the root of this repo is the source of truth for `bahulam install <name>` (and its explicit form `bahulam install bahulam:<name>`). The CLI fetches it, matches `name` case-insensitively, and delegates to the git installer. Every entry points `repository` at this repo itself with `ref: main` and a `subdir` — a shallow clone of that subdirectory IS the plugin.

<details>
<summary><strong>Registry schema</strong></summary>

```json
{
  "$schema": "https://docs.bahulam.ai/schemas/plugin-registry-1.json",
  "plugins": [
    {
      "name": "hello-world",
      "repository": "https://github.com/BahulamAI/awesome-bahulam-plugins",
      "ref": "main",
      "subdir": "plugins/hello-world",
      "description": "Minimal reference plugin",
      "author": "BahulamAI",
      "tags": ["reference", "starter"]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | ✓ | Lowercased match key for `install <name>` |
| `repository` | ✓ | Public git URL |
| `ref` | | Git tag or branch (default: `main`) |
| `subdir` | | Install a subdirectory instead of the whole repo |
| `tarball` | | HTTPS tarball URL (alternative to `repository`) |
| `description` | ✓ | One-line summary shown in listings |
| `author` | ✓ | GitHub handle or team name |
| `tags` | | Free-form: `seo`, `data`, `finance`, `ui`, `dev` … |

</details>

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. The short version:

1. **Fork** this repo
2. **Add** your plugin entry to `registry.json` (alphabetically sorted)
3. **Verify** it parses: `node -e 'JSON.parse(require("fs").readFileSync("registry.json"))'`
4. **Open a PR** with a link to your plugin, screenshots of any workspace view, and the output of `bahulam info <your-name>`

**Review checklist:**

- [ ] `plugin.yaml` at root with `apiVersion: bahulam.plugin/1`
- [ ] Every tool has a working module at its declared path
- [ ] `LICENSE` present (MIT / Apache-2.0 preferred)
- [ ] `selftest.mjs` or equivalent proves core logic offline
- [ ] No secrets, `curl | sh`, or credential prompts in tool modules
- [ ] README shows one working example per tool + screenshots of any view

---

## 📄 License

[MIT](./LICENSE) — © 2026 [BahulamAI](https://bahulam.ai)
