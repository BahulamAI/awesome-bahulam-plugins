# Plugin development guide

**Status:** authoring guidance for the existing CLI plugin contract; hosted chat
UI is specified separately as a proposal. Source review: 24 October 2026.

A Bahulam plugin packages a domain workflow: tools, durable results, an entry
agent when needed, and views of those results. Develop the domain logic once.
Local and hosted executors adapt access to state, artifacts, and connections;
views call the executor through a host adapter.

Start with this guide for a working local plugin. Use the
[Plugin UI and chat attachment contract](./plugin-ui-contract.md) when designing
a hosted version. That contract identifies platform work that is still needed;
adding its proposed fields to today's manifest does not enable hosted UI.

## 1. What exists today

| Capability | Current implementation | Author guidance |
| --- | --- | --- |
| Package | `bahulam.plugin/1`, tools, agents, MCP, views, state | Keep one plugin identity and version |
| Local UI | `config.views` HTML panels in the CLI browser workspace | Use this for a runnable plugin today |
| Local state | `options.state`, declared tables and generated read tools | Save results before presenting them |
| Local UI calls | Local HTTP API and `plugin_state_changed` events | Isolate these calls in a transport module |
| Chat widgets | `bahulam_render_v1`, shared web/mobile renderers | Use existing host widgets for ordinary charts and tables |
| Hosted interactive plugin attachment | No generic attachment/bridge contract in the reviewed chat code | Implement the proposed contract before claiming support |
| Capability declarations | Development CLI parses `skills`, `connectors`, `outcome_runtime`, `policy` | Metadata alone does not deploy, authorize, or enforce a capability |

This is a source snapshot, not a statement that every development feature is
in the published CLI. Record the CLI version used in your plugin README.

## 2. Start from a reference

From a checkout of this repository:

```bash
cp -R templates/outcome-runtime-plugin plugins/my-plugin
```

Use a Node version with built-in `node:sqlite` for this template's declared
tables and selftest. The CLI's broader Node compatibility does not guarantee
support for SQL-backed plugin state.

Rename `metadata.name`, the `PLUGIN` constant in the view, and agent names/slugs.
Rename tool names consistently in the manifest, handlers, agent allowlists, UI,
and selftest. Give tools domain-specific names so two installed plugins do not
collide. Replace the template's example workflow with a useful outcome.

```text
my-plugin/
  plugin.yaml                   Package identity and executable declarations
  config/workspace.yaml         Entry agent and tool allowlist
  config/agents/                Optional delegated agents
  tools/                       Domain operations
  workspace/index.html          Local view entry point
  workspace/                   UI assets; transport adapter can live here
  README.md                    Setup, examples, compatibility, permissions
  selftest.mjs                  Offline domain checks
```

The [outcome template](../templates/outcome-runtime-plugin) demonstrates state
and a live panel. [hello-world](../plugins/hello-world) demonstrates small ESM
tools and the shared stylesheet; [hello-mcp](../plugins/hello-mcp) demonstrates
MCP composition. Templates are starting points; apply the UI requirements below
before publication, including safe rendering of user-supplied text.

## 3. Declare the existing package contract

This is a minimal manifest example. The referenced handler, agent file, and HTML
file must exist; copy the reference files before validating it.

```yaml
apiVersion: bahulam.plugin/1
kind: Plugin
metadata:
  name: review-notes
  version: 0.1.0
  description: Review notes and present a word-count summary.
  author: YourTeam
config:
  tools:
    - name: review_notes_count
      description: Count words in supplied notes.
      tool: ./tools/count.mjs
      parameters:
        type: object
        properties:
          text: { type: string }
        required: [text]
        additionalProperties: false
  workspace: ./config/workspace.yaml
  views:
    - type: panel
      name: Notes
      source: ./workspace/index.html
```

`config.workspace` identifies the entry agent; `config.views` identifies its
UI. These are different declarations. Use `config.agents_from` for optional
helper agents, `config.mcpServers` for tools served over MCP, and
`config.composes` for reusable pi ingredients.

Agent files use `apiVersion: agent.framework/v1`, `metadata`, `agent`, and a
top-level `tools` allowlist. Keep that list explicit. A plugin view does not
require its own agent or a separate model call. The main agent can use the
plugin's tools and choose a presentation directly.

## 4. Implement tools and durable results

`tools/count.mjs` for the example above:

```js
export async function call(args = {}, { signal } = {}) {
  signal?.throwIfAborted();
  if (typeof args.text !== 'string') {
    return { success: false, output: 'text must be a string' };
  }
  const text = args.text.trim();
  return {
    success: true,
    output: { word_count: text ? text.split(/\s+/u).length : 0 },
  };
}
```

For a stateful workflow:

1. Validate arguments in the handler, even when a JSON Schema is declared.
2. Access local state through `await options.state`; do not hard-code a user's
   home directory or import the CLI's private storage implementation.
3. Declare SQL tables in `config.state.tables`. Use parameterized SQL. Put domain
   mutations in tools so the human UI and agent share the same operations.
4. Return structured results with stable domain IDs and a useful summary. Save
   generated files through the runtime's artifact facility when available.
5. Propagate `options.signal` to network calls and long-running work. Document
   limits, progress, retries, and whether repeating an operation is safe.

Use `config.state.context_tools` for generated reads. Keep `context_always`
small; loading an entire database into every agent turn is unnecessary.

For hosted portability, put environment access behind an adapter. A local
filesystem path or SQLite connection is not a portable result reference. A
hosted adapter must bind state and artifact IDs to the authenticated tenant,
workspace, and run; never select a tenant solely from tool arguments.

## 5. Build the local view

Use the stylesheet already served by the CLI:

```html
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vendor/bahulam-plugin/bahulam-plugin.css">
```

Use its `--ws-*` tokens, `.plugin-page`, `.plugin-bar`, `.plugin-body`, and
`.card` patterns. Extend the layout for the domain. Avoid copying another set
of brand colors, fonts, or navigation into each plugin.

The current local transport is:

| Operation | Local endpoint |
| --- | --- |
| Execute a tool | `POST /api/tools/execute` with `{name, args}` |
| Read plugin state | `POST /api/plugin-state/<plugin>` with `{op, ...args}` |
| Subscribe to updates | `GET /api/events` using `EventSource` |

The local iframe receives a session token in its URL; requests send
`X-Bahulam-Local-Token`. See [hello-world's view](../plugins/hello-world/workspace/index.html)
for the existing request/response shape. Keep that token inside the local
transport; never log it or include it in artifacts. This mechanism is specific
to the trusted local companion. Hosted frames use the proposed scoped bridge.

On `plugin_state_changed`, refresh relevant data, including coarse `kind: '*'`
events from another process. On reconnect, refetch the authoritative state.
Close subscriptions when the view is disposed. Show loading, empty, disconnected,
and error states; do not silently leave stale data looking current.

Render strings with `textContent` or framework escaping. Never interpolate
tool output, file content, or user text directly into `innerHTML`.

## 6. Standard UI behavior

These are publication requirements for new UI work. Some existing reference
plugins still need migration.

| Concern | Standard |
| --- | --- |
| Identity | Plugin name, result title, status, and last-updated information are visible |
| Styling | Consume host theme tokens; inherit typography; support host light/dark settings when supplied |
| Layout | Fit the available width, including a 320 CSS-pixel chat container; use bounded internal scrolling for wide data |
| Compact view | Show the outcome, a small preview, and the primary next action |
| Expanded view | Open the same result with the same selection; retain edits and state |
| Interaction | Label buttons by what they do; show pending/success/error; prevent accidental repeated writes |
| Accessibility | Keyboard access, visible focus, labeled inputs, text alternatives, reduced-motion support |
| Lifecycle | Loading, ready, empty, stale, unavailable, and permission-denied states |
| Source systems | Link to the source product when that is the useful next step |
| Ownership | Host owns attachment chrome, expand/open controls, permission prompts, and approvals |

The local stylesheet currently supplies default tokens; a standardized hosted
theme/lifecycle bridge is still proposed. Do not assume the stylesheet alone
implements chat theming or embedded sizing.

## 7. Prepare the hosted version

Keep one domain implementation behind the declared execution adapter:

```text
Main agent / UI action
        → authorized tool executor
        → local handler OR hosted plugin service / MCP
        → durable result
        → view of that result
```

Hosting requires a registered deployment, tenant-scoped state/artifacts,
connection handling, and execution policy. `availability: [chat]` is a
declaration, not deployment. Keep provider credentials in the configured host
or broker; expose connection status and opaque references to the UI.

For chat, first choose the smallest useful presentation:

- Existing chat chart/table/card for ordinary structured output.
- Registered plugin UI for a domain-specific interactive workflow.
- Text summary and an authorized open action when embedding is unsupported.

The main agent selects from enabled views using tool-result metadata and the
discussion context. The backend validates the choice and issues the attachment
reference. UI selection can also be deterministic when a tool has one default
view. No specialist rendering model is required.

Follow the [UI contract](./plugin-ui-contract.md) for the proposed registration,
attachment, bridge, persistence, and authorization rules. A hosted plugin runs
through the platform's runtime and connector services; this guide does not
require a second CLI agent loop inside the hosted application.

For hosted MCP views, the proposal adopts the existing MCP Apps transport.
Bahulam still needs the host integration and durable attachment layer; see the
contract's protocol references and implementation plan before advertising support.

## 8. Develop, review, and publish

From this repository, after renaming the copied template:

```bash
bahulam plugin validate ./plugins/my-plugin
node ./plugins/my-plugin/selftest.mjs
bahulam plugin install ./plugins/my-plugin
bahulam plugin info my-plugin
bahulam plugin my-plugin .
```

Preflight imports tool modules to check exports. Keep import-time code free of
network requests and other side effects. Confirm whether your installed CLI
copies or links a local directory; if edits are not reflected, reinstall the
development plugin deliberately rather than debugging a stale installed copy.

Document and review:

- One working example per tool, expected result, failure behavior, and screenshots.
- Required runtime versions, dependencies, network destinations, and setup.
- Tool schema and state migrations; never silently reinterpret saved results.
- How a result survives reload and how UI updates after an agent operation.
- Narrow-width, keyboard, theme, empty/error, and unavailable-host behavior.
- For hosted UI, the additional acceptance criteria in the proposed contract.

Publish an immutable release/tag and add a registry entry using
[CONTRIBUTING.md](../CONTRIBUTING.md). A local release and a hosted deployment
have separate readiness checks; list supported surfaces explicitly.

## 9. Contract ownership

| Contract | Owner |
| --- | --- |
| Package declaration, examples, author guide | This repository; CLI parser is the executable reference |
| Local loading, state and view transport | `codekepler-npm` |
| Shared chat payloads and surface rendering | `appstak-platform/packages/chat-render*` and `packages/chat-client` |
| Hosted resolution, tool execution, attachment persistence | `codekepler-backend` with existing platform services |
| Connections and credential isolation | Existing broker/gateway contracts, including PRD-104.1 and PRD-117 |
| Optional rich document rendering | `bahulam-workplane-ui`, using its own versioned document and adapters |

Workplane is a rendering option for a view that needs it. Its document and
renderer schemas remain owned by that library. Plugin state remains the source
of domain truth; a new universal visualization grammar is unnecessary.
