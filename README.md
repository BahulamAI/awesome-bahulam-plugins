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

A **plugin** bundles tools, sub-agents, and a live workspace panel into a single directory. Install any of them with one command:

```bash
bahulam plugin install <name>
```

---

## 🚀 Featured Plugins

<table>
<tr>
<td width="50%" valign="top">

### <a href="./plugins/hello-world">hello-world</a>
**Minimal reference plugin**

The starting point. One tool, one sub-agent, one workspace panel. Copy it and start building.

```
hello-world/
├── tools/        hello, word-count, collatz
├── workspace/    live panel with interactive buttons
└── selftest.mjs  smoke-test offline
```

`bahulam plugin install hello-world`

</td>
<td width="50%" valign="top">

### <a href="./plugins/hello-mcp">hello-mcp</a>
**MCP + UX reference pattern**

Bundles a stdio MCP server, JS state tools, a sub-agent that composes both, and a reactive workspace view. The blueprint for wrapping any MCP server as a Bahulam plugin.

```
hello-mcp/
├── mcp-server/   hex-color.mjs (zero-dep stdio server)
├── tools/        save-palette, list-palettes
├── workspace/    Palette Studio live UI
└── selftest.mjs
```

`bahulam plugin install hello-mcp`

</td>
</tr>
<tr>
<td width="50%" valign="top">

### <a href="./plugins/manim-studio">manim-studio</a>
**Text-to-video animation studio**

Describe a concept → the **animator** agent writes a Manim CE scene, launches a background render, and keeps working. The **render-reviewer** wakes on completion — verifies output, patches failures, re-renders. A live gallery updates as each video lands.

```
manim-studio/
├── tools/        save-scene, register-render, list-renders
├── workspace/    live render gallery
└── selftest.mjs
```

`bahulam plugin install manim-studio`

</td>
<td width="50%" valign="top">

### <a href="./plugins/redmine-studio">redmine-studio</a>
**Redmine ops Studio**

Composes <a href="https://www.npmjs.com/package/pi-redmine">pi-redmine</a>'s 11 REST tools with a persistent-state layer and a live workspace panel. The **redmine-analyst** agent handles the workflow — list projects, search issues, snapshot high-priority tickets.

```
redmine-studio/
├── tools/        save-issue-snapshot, list/drop-snapshots
├── workspace/    live issue tracker panel
└── plugin.yaml   composes pi-redmine as ingredients
```

`bahulam plugin install redmine-studio`

</td>
</tr>
<tr>
<td colspan="2" valign="top">

### <a href="./plugins/research-studio">research-studio</a>
**Research findings notebook**

A persistent notebook that survives across turns. Save, list, and drop research findings — each persists to a shared blackboard and populates the workspace panel. Composes with the web search and fetch tools for citation-backed research.

```
research-studio/
├── tools/        save-finding, list-findings, drop-finding
└── workspace/    notebook panel
```

</td>
</tr>
</table>

---

## ⚡ Quick Install

```bash
# Install by name (requires registry entry)
bahulam plugin install hello-world

# Install from git URL (any repo with a plugin.yaml)
bahulam plugin install https://github.com/BahulamAI/awesome-bahulam-plugins

# Install from a local checkout
bahulam plugin install ./my-plugin
```

Open a workspace to see the live panel:

```bash
bahulam plugin hello-world .
```

---

## 🧩 Plugin Architecture

Every Bahulam plugin follows the same contract:

| Layer | What it does | Example |
|---|---|---|
| **Tools** | `.mjs` modules the agent calls | `save-scene.mjs`, `hello.mjs` |
| **Sub-agents** | Specialists that compose tools | `animator`, `render-reviewer` |
| **Workspace** | Live HTML panels bound to state | `studio.html`, `index.html` |
| **Shared Blackboard** | Cross-process state that agents and panels read/write | render gallery, issue snapshots |
| **MCP servers** | Bundled stdio or remote servers | `hex-color.mjs`, pi-redmine |

Plugins are composable — `redmine-studio` wraps `pi-redmine` as an ingredient and adds persistent state on top. See the [Plugin Authoring Guide](https://docs.bahulam.ai/plugins) for the full contract.

---

## 📋 Registry

The `registry.json` at the root of this repo is the source of truth for `bahulam plugin install <name>`. The CLI fetches it, matches `name` case-insensitively, and delegates to the git installer.

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
4. **Open a PR** with a link to your plugin, screenshots of any workspace view, and the output of `bahulam plugin info <your-name>`

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
