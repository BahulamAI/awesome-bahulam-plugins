# awesome-bahulam-plugins

The community registry of open-source plugins for [Bahulam Code](https://bahulam.ai).

A **plugin** is a single directory that bundles tools, sub-agents, and a
workspace panel for one use case. Install one with a single command:

```bash
bahulam plugin install <name>                        # by registry name
bahulam plugin install https://github.com/foo/bar    # by git URL
bahulam plugin install ./my-plugin                   # from a local checkout
```

See the [plugin authoring guide](https://docs.bahulam.ai/plugins) for the
full contract.

---

## Registry (`registry.json`)

The `registry.json` at the root of this repo is the source of truth for
`bahulam plugin install <name>`. The CLI fetches it, matches `name`
case-insensitively, and delegates to the git installer.

```json
{
  "plugins": [
    {
      "name": "hello-world",
      "repository": "https://github.com/BahulamAI/awesome-bahulam-plugins",
      "ref": "main",
      "subdir": "plugins/hello-world",
      "description": "Minimal reference plugin — one tool, one sub-agent, one workspace panel",
      "author": "BahulamAI",
      "tags": ["reference", "starter"]
    }
  ]
}
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `name` | ✓ | Lowercased match key used by `install <name>` |
| `repository` | ✓ (git installs) | Public git URL |
| `ref` | | Git tag or branch (default: `main`) |
| `subdir` | | Install a subdirectory instead of the whole repo (used by this monorepo) |
| `tarball` | | HTTPS tarball URL (used instead of `repository`) |
| `description` | ✓ | One-line summary shown in listings |
| `author` | ✓ | GitHub handle or team name |
| `tags` | | Free-form categories: `seo`, `data`, `finance`, `ui`, `dev`, ... |

---

## Contributing a Plugin

1. Publish your plugin as its own public repo (or a subdirectory of one).
2. Tag a release (`v1.0.0` or later) — no floating `main` in your entry.
3. Open a PR to this repo adding one entry to `registry.json`.
4. Include in your PR description: what the plugin does, one screenshot per
   view, and a link to your `README.md`.

**Review checklist:**

- [ ] `plugin.yaml` at the repo (or `subdir`) root, `apiVersion: bahulam.plugin/1`
- [ ] Every tool declared has a working handler
- [ ] `LICENSE` present (MIT / Apache-2.0 preferred)
- [ ] A `selftest.mjs` or equivalent proves core logic runs offline
- [ ] No secrets, `curl | sh`, or credential prompts in handlers
- [ ] README shows one working example per tool + screenshots of any view

---

## Featured Plugins

| Plugin | Description | Author |
|---|---|---|
| [hello-world](./plugins/hello-world) | Minimal reference plugin | BahulamAI |

_(this list will grow as the community lands PRs)_
