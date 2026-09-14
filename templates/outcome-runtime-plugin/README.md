# Outcome Runtime Plugin Template

This is the minimum Bahulam-native plugin skeleton for a real outcome runtime.
It is intentionally not listed in `registry.json`; copy it when authoring a new
plugin.

```bash
cp -R templates/outcome-runtime-plugin plugins/my-plugin
```

Then rename:

- `metadata.name` in `plugin.yaml`
- `PLUGIN` in `workspace/index.html`
- entry agent slug/name in `config/workspace.yaml`
- tool names and table names as needed

## What This Template Teaches

- One entry agent through `config.workspace`
- One helper agent through `config.agents_from`
- Durable plugin state tables
- Generated read tools through `context_tools`
- Domain tools that write state
- A workspace panel that reads state and reacts to events
- A selftest that proves the outcome loop offline

## Bahulam Plugins And pi Packages

Bahulam supports both:

- pi packages as composable ingredients via `config.composes`
- Bahulam plugins as the first-class outcome app/runtime unit

Use pi when you want to reuse an existing tool package. Use a Bahulam plugin
when you want an installable workflow with agents, state, UI, artifacts, and a
path to hosted SaaS execution through MCP/Context Forge.
