# Azure Cost Analyzer

Azure Cost Management analysis plugin for Bahulam. Provides cost breakdowns,
budget alerts, and spending reports for Azure subscriptions.

## Views

This plugin ships two panels. They are additive: the Workplane view does not
replace or modify the original.

| View | What it is |
|---|---|
| **Azure Cost** | The original panel. Renders `dashboard_data` and the typed widgets the tools write to the `workplane` key. |
| **Azure Cost (Workplane)** | A [Workplane](https://github.com/BahulamAI/workplane-ui) document: scenes and addressable blocks a user and an agent edit through one validated command gateway. |

### How the Workplane view differs

Both read the same data through the same tools. The difference is what happens
to a change:

- Every durable change is a **validated transaction** against a document
  revision. Two edits to the same value produce a conflict the user resolves,
  rather than one silently overwriting the other.
- The write surface is **declared and typed**. `/filters/days` accepts an
  integer 1–365 and nothing else; a path that is not registered is refused by
  the authority, not merely hidden in the UI.
- A filter change **re-reads only the affected queries**, in one coherent group,
  with no model call.
- Selecting a service **highlights** the chart and filters the table, keyed on a
  stable service id rather than the display label.
- Money is handled in **integer minor units**, converted once at the tool
  boundary. Charts never round independently.
- A failing tool shows **its own error** — "credentials not configured" — rather
  than a zero or a spinner.

It stores its document under the `workplane_document` state key. The legacy
`workplane` key is never written by this view, so the two panels cannot contend
over one value. **Import legacy widgets** copies the current widget list in as a
one-way snapshot; those blocks carry literal values rather than queries, so they
do not refresh, and they say so.

### Building the view

Only needed if you change `workplane-src/`. The built artifacts
(`workspace/workplane.js`, `workspace/workplane.css`) are committed, because the
host serves a plugin directory statically with no build step — installing this
plugin requires no toolchain.

```bash
cd plugins/azure-cost-analyzer
npm install
npm run build        # or: npm run dev   (rebuild on change)
```

`package.json` currently resolves `@bahulam/workplane-ui` from a sibling
checkout via a `file:` path, so a fresh clone cannot rebuild the view until that
package is on npm. Change the dependency to a published version range once it
is — the committed bundle is unaffected either way.

## Data caveat

The tools in `tools/` return **fixed sample values**. They validate credentials
and fail cleanly without them, but they do not call Azure Cost Management yet.
Any figure either panel shows is sample data, not your spend.

## Configuration

This plugin requires Azure service principal credentials. Open the plugin
panel in your workspace and fill in:

| Field | Description |
|-------|-------------|
| Azure Subscription ID | UUID of the subscription to analyze |
| Azure Tenant ID | Azure AD tenant ID |
| Service Principal Client ID | App registration with Cost Management Reader role |
| Service Principal Secret | Client secret (stored locally, never sent to LLM) |
| Currency | Display currency (USD, EUR, GBP, etc.) |

Credentials are stored in the plugin's local SQLite state under `~/.bahulam/data/azure-cost-analyzer/state.db`.
The LLM reads them indirectly through tool handlers — raw credential values
never appear in the model context.

## Tools

- **azure_list_subscriptions** — List subscriptions with month-to-date cost
- **azure_cost_by_service** — Cost breakdown by Azure service
- **azure_budget_alerts** — Check budgets and alert on threshold breaches
- **azure_resources_by_type** — Cost breakdown by resource type with per-resource details (region, resource group, tags)
- **azure_cost_by_dimension** — Aggregate costs by region, resource group, tag, or resource type (slice-and-dice)
- **azure_cost_trend** — Daily cost trend data for line chart visualization

## Security

- Credentials are stored locally in SQLite, never sent to backend
- Tool handlers read values via `state.getConfig(key)` in-process
- The LLM sees only tool outputs (already-processed cost data)
- Panel settings form masks credential fields in the browser
- `GET /api/plugin-config/<plugin>` returns `"***set***"` for credential values