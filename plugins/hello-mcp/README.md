# hello-mcp

Reference plugin proving the **Plugin = MCP + UX** pattern. Copy it as the
template when you want to wrap an MCP server as a Bahulam plugin.

## What's inside

```
hello-mcp/
├── plugin.yaml              # declares mcpServers, tools, agents, workspace
├── mcp-server/
│   └── hex-color.mjs        # bundled stdio MCP server (stdlib Node, zero deps)
├── tools/
│   ├── save-palette.mjs     # JS tool that writes to the Shared Blackboard
│   └── list-palettes.mjs    # JS reader for the blackboard
├── workspace/
│   └── index.html           # live UI — subscribes to plugin_state_changed
└── README.md
```

**Three tool types in one plugin, all callable from the same agent and view:**

| Kind | Example | Called as | Runs on |
|---|---|---|---|
| MCP (namespaced) | `palette.describe_color` | `<server>.<tool>` | Bundled stdio subprocess |
| JS (Bahulam-native) | `save_palette` | plain name | Handler in the CLI process |
| Built-in | `read_file` | plain name | CLI's built-in tool map |

## Install

```bash
bahulam install hello-mcp                                     # via registry (this repo, subdir: plugins/hello-mcp)
bahulam install bahulam:hello-mcp                             # explicit prefix, same result
bahulam install https://github.com/BahulamAI/awesome-bahulam-plugins \
  --subdir plugins/hello-mcp                                  # or clone by git URL
```

## Try it

```bash
bahulam plugin hello-mcp .
```

Opens a workspace with a "Palette Studio" tab. Then, in the agent:

```
> /run palette-designer design 3 palettes seeded from #0891B2, #F97316, and #7C3AED
```

Watch the saved list refresh as each `save_palette` call lands — that's the
shared blackboard pattern working end-to-end.

## Swap the MCP server for a real one

The bundled `hex-color.mjs` is stdlib Node so this repo is 100% self-contained.
Real plugins usually pin a proper server. Replace the `mcpServers` block:

```yaml
mcpServers:
  # Python via uvx (spawned at plugin activation, torn down at close)
  quant-engine:
    command: uvx
    args: [options-quant-mcp]

  # Any local binary
  code-index:
    command: /usr/local/bin/mcp-code-index
    args: [--repo, "${WORKSPACE_ROOT}"]

  # Remote MCP over SSE / streamable-HTTP
  markets:
    url: https://mcp.tradeco.com/sse
    headers:
      Authorization: Bearer ${MCP_TRADECO_TOKEN}
```

Or drop a `mcp.json` next to `plugin.yaml` if you already have one:

```json
{ "mcpServers": { "quant-engine": { "command": "uvx", "args": ["options-quant-mcp"] } } }
```

Both shapes merge (inline wins on collision).

## Learn more

- [Plugin authoring guide](https://docs.bahulam.ai/plugins) — §1.7 covers MCP end-to-end
- [Contributing to the registry](../../CONTRIBUTING.md)
