# Azure Cost Analyzer

Azure Cost Management analysis for Bahulam: cost breakdowns by service, resource
type and arbitrary dimension, daily trend, and budget-threshold checks.

The tools call Azure Cost Management for real — OAuth2 client credentials, the
Query API, `Retry-After` on 429, and `nextLink` pagination. There is no sample
data anywhere: a tool that cannot read Azure says so and returns no figure,
because a plausible number with nothing behind it is worse than an error.

## How a result becomes something you can check

Each tool records what it read into this plugin's own SQLite state before
returning, in two declared tables:

| Table | One row per | Carries |
|---|---|---|
| `cost_runs` | tool execution | capture time, tool, scope (subscription + window), currency, currency exponent |
| `cost_rows` | figure in that run | position, dimension, label, amount in **integer minor units** |

`cost_runs` is the point of the split. A figure with no capture time, no scope
and no currency is a number a reader cannot verify, so the provenance is stored
once per run and the rows reference it.

Money is converted to integer minor units once, at the tool boundary, with the
currency's exponent stored beside it — JPY has no minor unit, KWD has three.
Nothing downstream rounds a second time, so two readers cannot disagree about
the cent.

Recording is deliberately best-effort. A plugin whose database is unavailable
still answers the question: losing a snapshot costs the panel a card, while
failing the tool costs the user their answer.

## The panel

One view, **Azure Cost** (`workspace/state.html`): a deterministic reader of the
tables above.

It interprets nothing. Tables are discovered from the database rather than
hardcoded, rows appear in the order stored, and the only transformation is
turning minor units back into an amount using the stored exponent. No charts, no
derived totals, no agent-authored layout. A viewer that computes things is a
viewer that can quietly disagree with the database it exists to show.

It is a single self-contained file with no build step and no external asset —
the host serves a plugin directory statically, and a relative `<script src>`
would inherit no session token and fail. It re-reads on the host's
`plugin_state_changed` event, and has a Refresh button for when that stream is
unavailable.

Composition, agent-authored visuals and versioned documents are a separate
concern; see PRD-108 §28.5 for why they are not here.

## Configuration

Azure service principal credentials, entered in the plugin's settings form:

| Field | Description |
|---|---|
| Azure Subscription ID | UUID of the subscription to analyse |
| Azure Tenant ID | Azure AD tenant ID |
| Service Principal Client ID | App registration with the Cost Management Reader role |
| Service Principal Secret | Client secret |
| Currency | Fallback only — the figure's currency comes from Azure's own response |

Stored in the plugin's local SQLite state at
`~/.bahulam/data/azure-cost-analyzer/state.db`. Tool handlers read them
in-process through `state.getConfig(key)`; raw values never enter the model
context, and `GET /api/plugin-config/<plugin>` returns `"***set***"` for them.

The `Currency` field is a fallback and nothing more. A subscription billing in
INR while this said USD is a real condition that made two tools report different
currencies for the same data, so currency now comes from Azure's own column and a
mismatch is reported rather than resolved silently.

## Tools

| Tool | Returns |
|---|---|
| `azure_list_subscriptions` | Accessible subscriptions with month-to-date cost |
| `azure_cost_by_service` | Cost by Azure service |
| `azure_cost_by_dimension` | Cost by region, resource group, tag, or resource type |
| `azure_resources_by_type` | Per-resource cost with region, resource group and type |
| `azure_cost_trend` | Daily cost over a window |
| `azure_budget_alerts` | Budgets, consumption, and threshold breaches |

## Skill

`skills/azure-cost-investigation` carries the investigation order, how to present
findings, and the guardrails. It names no tool shape or table schema: those are
published by the tools and the manifest, and duplicating them in prose is how
documentation starts lying.

## Tests

```bash
node selftest.mjs      # 68 checks, no network, injected fetch
```

Covers the Azure client (auth, pagination, retry, column lookup by name), what
each tool records, that money round-trips exactly through integer minor units in
currencies with zero, two and three minor digits, and that every failure mode
surfaces rather than becoming a zero.
