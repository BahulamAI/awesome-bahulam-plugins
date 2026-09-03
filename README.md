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
    <img src="https://img.shields.io/badge/plugins-5-brightgreen.svg" alt="Plugins">
  </p>
</p>

---

A **plugin** bundles tools, sub-agents, and a live workspace panel into a single directory.

**Hand-authored packs** (this repo) — install by name or from a URL:
  `bahulam install <name>` (or `bahulam install bahulam:<name>` with the
  explicit prefix). Registry entries here point `repository` at this repo
  itself with a `subdir` per pack — the community repo IS the source.

**[pi](https://www.npmjs.com/search?q=pi-) ecosystem** — pi packages are first-class
  **ingredients** in the plugin system. Plugins compose them directly in `plugin.yaml`
  via the `composes:` block (see `redmine-studio` which brings in all 11 pi-redmine
  tools). Use a pi package standalone to experiment:
  `bahulam install pi:pi-redmine`

**Plugin = pi + state + workspace + agent** — every studio in this repo wraps a pi
  package with a persistent blackboard, a workspace panel, and a specialist agent.
  The user just runs `bahulam install <studio>` — the pi tools come along
  automatically via the pack's `composes:` block.

---

## 🚀 Featured Plugins

<div style="display: flex; flex-wrap: wrap; gap: 24px; margin: 24px 0;">

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [hello-world](./plugins/hello-world)
**Minimal reference plugin** · `reference` `starter`

The starting point. One tool, one sub-agent, one workspace panel. Copy it and start building.

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

Bundles a stdio MCP server, JS state tools, a sub-agent that composes both, and a reactive workspace view. The blueprint for wrapping any MCP server as a Bahulam plugin.

- `mcp-server/` — hex-color.mjs (zero-dep stdio server)
- `tools/` — save-palette, list-palettes
- `workspace/` — Palette Studio live UI
- `selftest.mjs` — offline smoke test

```bash
bahulam install hello-mcp
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [manim-studio](./plugins/manim-studio)
**Text-to-video animation studio** · `showcase` `video` `manim` `education`

Describe a concept → the **animator** agent writes a Manim CE scene, launches a background render, and keeps working. The **render-reviewer** wakes on completion — verifies output, patches failures, re-renders. A live gallery updates as each video lands.

- `tools/` — save-scene, register-render, list-renders
- `workspace/` — live render gallery
- `selftest.mjs` — offline smoke test

```bash
bahulam install manim-studio
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [redmine-studio](./plugins/redmine-studio)
**Redmine ops Studio** · `showcase` `devops` `project-management`

Composes [pi-redmine](https://www.npmjs.com/package/pi-redmine)'s 11 REST tools with a persistent-state layer and a live workspace panel. The **redmine-analyst** agent handles the workflow — list projects, search issues, snapshot high-priority tickets.

- `tools/` — save-issue-snapshot, list/drop-snapshots
- `workspace/` — live issue tracker panel
- `plugin.yaml` — composes pi-redmine as ingredients

```bash
bahulam install redmine-studio               # hand-authored pack
bahulam install pi:pi-redmine                # or scaffold from the pi ingredient
```

</div>

<div style="flex: 1 1 calc(50% - 24px); min-width: 280px; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; background: #f6f8fa;">

### [research-studio](./plugins/research-studio)
**Research findings notebook** · `reference` `research`

A persistent notebook that survives across turns. Save, list, and drop research findings — each persists to a shared blackboard and populates the workspace panel. Composes with the web search and fetch tools for citation-backed research.

- `tools/` — save-finding, list-findings, drop-finding
- `workspace/` — notebook panel

```bash
bahulam install research-studio
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

# —· Plugin with full pi integration (pi tools come as composed ingredients) ·—
bahulam install redmine-studio              # includes all 11 pi-redmine tools via composes:
bahulam install research-studio      # includes pi-web-access search/fetch tools

# —· pi ecosystem standalone ·—
bahulam install pi:pi-redmine                # auto-scaffold a full pack from a pi package
bahulam pull pi:pi-web-access                # 🧩 raw ingredient (composable, not directly runnable)
```

Open a workspace to see the live panel:

```bash
bahulam plugin hello-world .
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
<td><strong>Pi ingredients 🆕</strong></td>
<td>Composed <code>pi:*</code> packages from npm — tools become plugin tools via <code>composes:</code></td>
<td><code>pi-redmine</code> (11 tools), <code>pi-web-access</code> (4 tools)</td>
</tr>
</table>

Plugins are composable — `redmine-studio` wraps `pi-redmine` as an ingredient and adds persistent state on top. See the [Plugin Authoring Guide](https://docs.bahulam.ai/plugins) for the full contract.

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