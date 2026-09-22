# Azure Cost Analyzer

Azure Cost Management analysis plugin for Bahulam. Provides cost breakdowns,
budget alerts, and spending reports for Azure subscriptions.

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