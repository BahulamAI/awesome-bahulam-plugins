# Contributing

## Adding your plugin to the registry

1. Fork this repo.
2. Prefer a Bahulam-native plugin for publishable work. Start from
   `templates/outcome-runtime-plugin` when you need an entry agent, state,
   workspace UI, and a future SaaS/MCP path.
3. Use pi packages as ingredients through `config.composes` when they provide
   useful tools, but publish the Bahulam plugin as the user-facing app/runtime.
4. Add one entry to `registry.json` (keep the array alphabetically sorted).
5. Verify the JSON parses: `node -e 'JSON.parse(require("fs").readFileSync("registry.json"))'`
6. Open a PR with:
   - Link to your plugin repo
   - Screenshot(s) of any workspace view
   - Output of `bahulam install <your-git-url> && bahulam info <your-name>`

## Adding your plugin as a subdirectory here

If your plugin is small and doesn't warrant its own repo, we accept
subdirectory contributions under `plugins/`. Include:

- `plugin.yaml` (manifest)
- `README.md` (one example per tool + screenshots)
- `LICENSE` (or inherit the repo's MIT if you sign the CLA)
- A `selftest.mjs` if your tool modules have non-trivial logic

Use the `subdir` field in your `registry.json` entry so the CLI knows to
install only your subdirectory.

## Bahulam plugins vs pi packages

Bahulam supports both:

- pi packages are composable tool ingredients.
- Bahulam plugins are the first-class outcome runtime: entry agent, tools/MCP,
  state, workspace UX, artifacts, and publish/review metadata.

If your contribution is mainly a reusable tool package, compose it from pi.
If it should deliver a user-visible workflow, wrap it as a Bahulam plugin. The
hosted/SaaS direction is to expose plugin tools through MCP/Context Forge rather
than maintaining separate backend copies.

## Manifest hygiene

- `apiVersion: bahulam.plugin/1` is the only supported version
- Everything lives under `config:` — `config.tools`,
  `config.workspace` (entry agent path), `config.agents_from`
  (subagent folder), `config.views`, `config.mcpServers`, and
  `config.composes`. Unknown keys are dropped.
- Agent files referenced by `config.workspace` and `config.agents_from`
  use the backend-compatible `apiVersion: agent.framework/v1` shape:
  `metadata` for identity, `agent` for prompt/runtime caps, and top-level
  `tools` for the allowlist.
- Each tool entry points at its module with `tool: ./tools/<name>.mjs`
  (the legacy `handler:` key is not accepted)
- Tool names: `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`, must not shadow built-ins
- Tool modules must be pure ESM (`.mjs`), no CommonJS
- Every tool module MUST export `async call(args, options)` returning
  `{ success: boolean, output: any }` and honor `options.signal` for
  long-running work

## Workspace views

- Views are sandboxed iframes; call tools via `POST /api/tools/execute`
  and read state via `POST /api/plugin-state/<plugin>`
- Subscribe to `/api/events` and re-render on `plugin_state_changed`.
  Handle your precise `{kind, target}` events AND the coarse
  `{kind: '*'}` pulse — the server emits it when another process (the
  terminal agent, a headless run) writes your state. A view that renders
  once at mount will be rejected: the panel is a live shared canvas.

## Security policy

- **Never** ship credentials in a tool module, manifest, or view
- **Never** exec `curl | sh`, `bash -c`, or anything that fetches remote code
- If your plugin needs network access, document the endpoints in your README
- If your plugin needs a secret, read it from a documented env var — do not
  prompt for it in a view (the browser is not a credential store)

Anything that violates the security policy will be removed from the registry
without notice.
