# Azure Governance: End-to-End Guide

This guide takes a new user from an empty machine to a repeatable Azure
governance review. The plugin collects read-only evidence, stores each scan,
runs focused analyses, and creates an executive Markdown report. It never
changes Azure resources or access.

## 1. Understand the workflow

Every review follows the same order:

```text
Authenticate to Azure
        |
        v
azure_inventory_scan        Collect and persist evidence
        |
        +--> azure_cost_report
        +--> azure_access_matrix
        +--> azure_security_findings
        +--> azure_tag_audit
        +--> azure_waste_report
        |
        v
azure_governance_report     Combine the scan and recorded findings
```

`azure_inventory_scan` must run first. It returns a numeric scan ID and stores
the complete normalized snapshot. Each later tool uses the latest scan by
default, or a specific historical scan when `scan_id` is provided.

Choose one collection mode:

| Mode | Best for | Azure connection | Coverage |
|---|---|---|---|
| `azure_cli` | First live scan and routine reviews | Existing `az login` session | Inventory, Resource Graph, RBAC, Policy, Defender, Advisor, and optional aggregated costs |
| `azure_sdk` | Deep identity, metrics, cost, PIM, and control reviews | `DefaultAzureCredential` | CLI coverage plus opt-in Cost Details, benefits, metrics, Entra, PIM, diagnostics, and locks |
| `snapshot` | Demonstrations, CI, or exported evidence | None | Only the arrays supplied to the tool |

Start with Azure CLI unless you need an SDK-only feature.

## 2. Install the prerequisites

You need:

- Bahulam CLI and Node.js.
- Azure CLI for the recommended first-run path.
- An Azure identity with read access to the subscriptions being reviewed.
- Cost or directory permissions only when those optional data sources are
  enabled.

Verify the commands:

```bash
bahulam --version
node --version
az version
```

Install the plugin from the Bahulam registry:

```bash
bahulam install azure-governance
```

From a local checkout, use:

```bash
bahulam install ./plugins/azure-governance
```

The registry installation is copied to
`~/.bahulam/plugins/azure-governance/`. The local command is useful while
developing or testing changes in this repository.

## 3. Grant read-only Azure access

Ask an Azure administrator to assign only the roles needed by your selected
features, at the narrowest management group, subscription, or resource-group
scope that covers the review.

| Evidence | Typical access |
|---|---|
| Resources, Resource Graph, Advisor, and general configuration | `Reader` |
| Cost Query, Cost Details, and benefit recommendations | `Cost Management Reader` or suitable billing read access |
| Azure Monitor utilization metrics | `Monitoring Reader` or equivalent metrics read access |
| Detailed role assignment inspection and PIM | `Microsoft.Authorization/roleAssignments/read` and related schedule read permissions; use an approved read-only custom role where required |
| Entra principal names | Microsoft Graph `Directory.Read.All` |
| Transitive group memberships | `GroupMember.Read.All` or `Directory.Read.All` |
| Application credentials and federation | `Application.Read.All` |
| User sign-in activity | `AuditLog.Read.All` |

Azure RBAC roles and Microsoft Graph permissions are different permission
systems. Enabling `include_principals` or another identity option does not grant
consent automatically. A tenant administrator may need to approve the Graph
application permissions used by your identity.

Avoid assigning `Owner`, `Contributor`, or another write role merely to run
this plugin. Microsoft maintains the current definitions in the
[Azure built-in roles reference](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles).

## 4. Authenticate and verify scope

For an interactive local review:

```bash
az login
az account list --all --output table
az account show --output table
```

If you use several tenants, sign in to the intended tenant explicitly:

```bash
az login --tenant <tenant-id>
```

Set a default subscription for manual validation commands:

```bash
az account set --subscription <subscription-id>
```

The plugin still uses `subscription_ids` from the scan request when they are
provided. Setting the CLI default does not override that list.

Install and test the Resource Graph extension:

```bash
az extension add --name resource-graph
az graph query --graph-query "Resources | project id, name, type | take 3" --output table
```

The extension can also install automatically on the first `az graph` command,
but explicit installation makes preflight failures easier to diagnose. See the
[official Azure CLI authentication guide](https://learn.microsoft.com/cli/azure/authenticate-azure-cli)
and [`az graph` reference](https://learn.microsoft.com/cli/azure/graph).

Before opening Bahulam, confirm each target subscription is visible:

```bash
az account show --subscription <subscription-id> --output table
az resource list --subscription <subscription-id> --query "[0].id" --output tsv
az role assignment list --all --subscription <subscription-id> --query "[0].id" --output tsv
```

An empty result can be legitimate. An authorization error means the signed-in
identity lacks access at that scope.

## 5. Open the Azure Governance workspace

From the project you want to associate with the review, run:

```bash
bahulam plugin azure-governance .
```

This opens the plugin workspace and activates the Azure Governance director.
You can ask it to execute the whole workflow conversationally:

```text
Scan subscription 00000000-0000-0000-0000-000000000000 using Azure CLI.
Include costs from 2026-09-01 through 2026-09-30. Then run cost, access,
security, tag, and waste reviews and produce the executive report. Use owner,
environment, costCenter, and application as required tags.
```

Replace the subscription ID and dates. Do not paste client secrets, access
tokens, certificates, or passwords into the chat.

## 6. Run the recommended Azure CLI workflow

The examples below are tool requests entered in the Bahulam workspace chat,
not shell commands.

### Step 1: collect and persist the estate

```text
azure_inventory_scan {
  name: "production monthly review - 2026-09",
  collect_from: "azure_cli",
  subscription_ids: [
    "00000000-0000-0000-0000-000000000000",
    "11111111-1111-1111-1111-111111111111"
  ],
  use_resource_graph: true,
  graph_page_size: 1000,
  include_costs: true,
  cost_start_date: "2026-09-01",
  cost_end_date: "2026-09-30",
  cost_granularity: "Daily",
  cost_dimensions: ["resource_group", "service"]
}
```

What happens:

- The collector discovers the selected subscriptions and resource groups.
- Resource Graph pages through inventory, role definitions, Policy, Defender,
  regulatory compliance, and Advisor evidence.
- Azure CLI collects role assignments at each selected subscription.
- Cost Management returns daily cost grouped by at most two dimensions.
- The normalized snapshot and its collection coverage are stored in plugin
  state.
- The result contains an `id`; retain it when comparing or revisiting scans.

`graph_page_size` accepts 1 through 1,000. Resource Graph is on by default. If
the extension cannot run, the CLI collector records a warning and falls back to
`az resource list`, which provides less governance evidence.

For inventory without billing data, omit `include_costs` or set it to `false`.

### Step 2: analyze dollar cost

```text
azure_cost_report {
  scan_id: <scan-id>,
  group_by: "resource_group",
  min_idle_cost_usd: 25,
  idle_cpu_threshold_percent: 5,
  min_rightsizing_cost_usd: 50,
  rightsizing_cpu_threshold_percent: 20,
  min_commitment_days: 14,
  min_commitment_cost_usd: 100
}
```

Run other useful views by changing `group_by` to `subscription`, `service`,
`region`, `meter`, `sku`, `resource`, or `tag`. When grouping by tag, add
`tag_key`, for example `tag_key: "costCenter"`. Add `resource_group` to narrow
the report to one group.

Review these output sections:

- `total_cost_display` and `top_drivers` for observed spend.
- `daily_costs`, `forecast`, and `anomalies` for trend changes.
- `untagged_cost_display` for cost without ownership metadata.
- `optimization.idle_expensive_resources` for low-use paid resources.
- `optimization.rightsizing_recommendations` for Advisor or metric evidence.
- `optimization.commitment_candidates` for inferred stable usage.
- `optimization.native_commitment_recommendations` for Azure-quoted benefits.

All reported cost and savings fields marked `_usd` or displayed with `$` are
US dollars. Source-currency evidence may be retained, but it is never relabeled
as dollars.

### Step 3: review access

```text
azure_access_matrix {
  scan_id: <scan-id>,
  include_group_access: true,
  stale_days: 90,
  pim_expiry_days: 30,
  credential_expiry_days: 30,
  format: "all"
}
```

The CLI path supplies role assignments and role definitions. Group expansion,
PIM, credential expiry, federation, and sign-in evidence require the SDK
options described later.

Use filters for focused questions:

```text
azure_access_matrix {
  scan_id: <scan-id>,
  principal: "alice@example.com",
  format: "markdown"
}
```

```text
azure_access_matrix {
  scan_id: <scan-id>,
  scope: "/subscriptions/<subscription-id>/resourceGroups/rg-production",
  scope_level: "resource_group",
  format: "csv"
}
```

Pay special attention to privileged assignments, broad management-group or
subscription scope, custom roles with write permissions, unknown principals,
inactive identities, and workload identities with broad access.

### Step 4: review security and compliance

```text
azure_security_findings {
  scan_id: <scan-id>,
  evaluate_missing_controls: true,
  production_tag_values: ["prod", "production"],
  minimum_secure_score_percent: 70
}
```

This evaluates internet exposure, permissive firewall rules, Policy states,
Defender assessments, secure scores, and regulatory evidence. Missing-control
findings are emitted only when the corresponding collection coverage is known
to be complete. For the strongest diagnostics, locks, activity-log export, and
private endpoint checks, use the SDK path with
`include_governance_details: true`.

### Step 5: audit governance tags

```text
azure_tag_audit {
  scan_id: <scan-id>,
  required_tags: ["owner", "environment", "costCenter", "application"]
}
```

Tag keys are checked case-insensitively across resources and resource groups.
Choose tags that reflect your organization's policy; the four shown above are
the defaults when `required_tags` is omitted.

### Step 6: identify waste

```text
azure_waste_report { scan_id: <scan-id> }
```

The report identifies likely unattached disks and public IPs, stopped but
possibly allocated VMs, snapshots older than 30 days, and Azure Advisor cost
recommendations. Treat every result as a candidate for owner validation, not
as permission to delete the resource.

### Step 7: generate the final report

Run the final tool only after the finding-producing tools above. It combines
the snapshot with findings already recorded for that scan.

```text
azure_governance_report { scan_id: <scan-id> }
```

The result contains `output.markdown` and a structured summary. It includes
estate size, dollar cost, privileged access, Policy and Defender posture,
identity evidence, findings by severity, and recommended next actions.

## 7. Enable the advanced SDK workflow

Use `azure_sdk` when the review requires deeper Cost Management, Azure Monitor,
Entra, PIM, diagnostic-setting, or lock evidence.

Install the SDK packages inside the installed plugin directory or the local
plugin directory used by Bahulam:

```bash
cd ~/.bahulam/plugins/azure-governance
npm install @azure/identity @azure/arm-resourcegraph \
  @azure/arm-costmanagement @azure/arm-authorization \
  @azure/arm-policyinsights
```

On PowerShell, put the package names on one line or use PowerShell's backtick
line continuation instead of `\`.

`DefaultAzureCredential` can reuse the active Azure CLI session. It can also
use a managed identity or service principal. For service principal
authentication, set environment variables in the process that launches
Bahulam:

```bash
export AZURE_TENANT_ID=<tenant-id>
export AZURE_CLIENT_ID=<application-client-id>
export AZURE_CLIENT_SECRET=<secret-from-a-secure-store>
```

PowerShell equivalent:

```powershell
$env:AZURE_TENANT_ID = "<tenant-id>"
$env:AZURE_CLIENT_ID = "<application-client-id>"
$env:AZURE_CLIENT_SECRET = "<secret-from-a-secure-store>"
```

Do not write these values into this guide, `plugin.yaml`, prompts, or source
control. See the Microsoft documentation for
[`DefaultAzureCredential`](https://learn.microsoft.com/javascript/api/@azure/identity/defaultazurecredential).

Run a base SDK scan first:

```text
azure_inventory_scan {
  name: "production SDK baseline",
  collect_from: "azure_sdk",
  subscription_ids: ["00000000-0000-0000-0000-000000000000"],
  include_costs: true,
  cost_start_date: "2026-09-01",
  cost_end_date: "2026-09-30",
  cost_granularity: "Daily",
  cost_dimensions: ["resource_group", "service"]
}
```

Then enable only the enrichments for which permission has been approved:

```text
azure_inventory_scan {
  name: "production deep governance review",
  collect_from: "azure_sdk",
  subscription_ids: ["00000000-0000-0000-0000-000000000000"],
  management_group_ids: ["contoso-root"],
  include_cost_details: true,
  cost_details_max_wait_seconds: 300,
  include_benefit_recommendations: true,
  include_monitor_metrics: true,
  metric_lookback_days: 14,
  metric_resource_limit: 250,
  include_principals: true,
  include_group_memberships: true,
  group_membership_limit: 5000,
  include_pim: true,
  include_identity_details: true,
  include_service_principal_sign_ins: false,
  identity_detail_limit: 1000,
  include_governance_details: true,
  governance_detail_limit: 1000,
  cost_start_date: "2026-09-01",
  cost_end_date: "2026-09-30"
}
```

Important option behavior:

| Option | Adds | Main consideration |
|---|---|---|
| `include_costs` | Aggregated Cost Query rows | Use `cost_dimensions`; maximum two dimensions |
| `include_cost_details` | Asynchronous line-level Cost Details | Can take longer; uses `cost_details_max_wait_seconds` |
| `include_benefit_recommendations` | Native reservation and Savings Plan quotes | Requires cost/billing read access |
| `include_monitor_metrics` | Utilization evidence for right-sizing | Bound work with lookback and resource limit |
| `include_principals` | Entra names and account state | Requires Graph directory permission |
| `include_group_memberships` | Effective transitive group access | Also enable principal collection |
| `include_pim` | Eligible and active Azure RBAC schedules | Requires schedule read access at each scope |
| `include_identity_details` | App credentials, federation, user sign-ins | Requires application and audit permissions |
| `include_service_principal_sign_ins` | Service principal sign-in evidence | Optional beta Microsoft Graph report |
| `include_governance_details` | Diagnostics, activity-log export, and locks | More ARM requests; limit controls collection size |

After the scan, run the same Steps 2 through 7 from the CLI workflow. Analysis
tools do not need a different syntax for SDK evidence.

## 8. Use an offline snapshot

No Azure login is needed when evidence is exported or synthetic:

```text
azure_inventory_scan {
  name: "offline review",
  tenant_id: "tenant-001",
  collect_from: "snapshot",
  subscriptions: [{ id: "sub-001", name: "Production" }],
  resource_groups: [
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-app",
      name: "rg-app",
      subscription_id: "sub-001",
      tags: { environment: "prod", owner: "platform@example.com" }
    }
  ],
  resources: [],
  role_assignments: [],
  costs: [
    {
      subscription_id: "sub-001",
      resource_group: "rg-app",
      service: "Virtual Machines",
      date: "2026-09-01",
      cost: 125.40,
      currency: "USD"
    }
  ]
}
```

Supply empty arrays deliberately when collection was complete and found no
rows. Omit an evidence array when it was not collected. This distinction helps
coverage-aware checks avoid reporting missing controls from incomplete data.

## 9. Read collection results correctly

Check the inventory result before trusting downstream analysis:

- `collector.source` identifies `azure_cli`, `azure_sdk`, or `snapshot`.
- `collector.engine` indicates whether Resource Graph ran.
- `collector.warnings` lists partial failures and missing optional permission.
- `collector.resource_graph_succeeded` confirms the CLI graph path.
- Summary counts show subscriptions, resources, roles, policies, and evidence
  actually persisted.
- `coverage` in the stored scan distinguishes collected evidence from data that
  was never requested or could not be read.

A successful scan can contain warnings when optional enrichment fails. For
example, inventory can succeed while Graph directory consent is absent. Resolve
warnings relevant to your review, rerun the scan with a new name, and use the
new scan ID.

## 10. Compare scans and run recurring reviews

Use a stable naming convention so operators can find scans later:

```text
<environment> <cadence> <YYYY-MM-DD>
production monthly 2026-09-30
```

A practical cadence is:

1. Weekly: CLI inventory, security, tags, and waste.
2. Monthly: include a full billing period, cost optimization, and access review.
3. Quarterly: SDK deep review with group expansion, PIM, identity lifecycle,
   diagnostics, locks, metrics, and benefit recommendations.
4. After major organizational or subscription changes: create a fresh scan and
   retain the previous scan ID for comparison.

To revisit an older scan, pass its `scan_id` to every analysis tool. Use the
plugin's `list_azure_scans` context tool to locate IDs and
`list_azure_findings` to inspect recorded findings by scan or category.

## 11. Troubleshooting

### `az` is not installed or cannot be found

Install Azure CLI using Microsoft's instructions, reopen the terminal, and run
`az version`. Bahulam must inherit a `PATH` that contains the `az` executable.

### Azure CLI is not logged in

Run `az login`, or `az login --tenant <tenant-id>`, then verify with
`az account show`. Conditional Access may require an interactive sign-in.

### The subscription is missing

Run `az account list --all --output table`. Confirm the correct tenant and that
the identity has a role assignment at the subscription or an inherited parent
scope. Pass the subscription explicitly in `subscription_ids`.

### Resource Graph fails

Run:

```bash
az extension add --name resource-graph --upgrade
az graph query --graph-query "Resources | take 1"
```

The CLI collector falls back to `az resource list`, but Policy, Defender,
Advisor, and role-definition coverage will be reduced. Inspect collector
warnings rather than assuming full coverage.

### Costs are empty or authorization fails

Confirm the date range contains finalized or available usage and grant Cost
Management Reader or the appropriate billing-scope read role. Cost visibility
can differ from ordinary subscription Reader access. First retry a short range
on one subscription.

### SDK packages are missing

Install packages in the same plugin directory that Bahulam executes. A package
installed only in an unrelated project directory may not resolve from the
installed plugin.

### Principal names are unresolved

Set `include_principals: true`, verify Graph consent for `Directory.Read.All`,
and inspect warnings. Without enrichment, role assignments can still appear by
object ID and `principalType` may remain unknown.

### Missing diagnostics or lock findings do not appear

Use `collect_from: "azure_sdk"` with `include_governance_details: true`.
Coverage-aware analysis intentionally suppresses missing-control claims when
collection did not prove that the evidence set was complete.

### The final report has few findings

Run `azure_security_findings`, `azure_tag_audit`, and `azure_waste_report`
before `azure_governance_report`. The final report reads findings already
recorded for that scan; it does not silently rerun all analyses.

## 12. Operational safety checklist

Before sharing or acting on a report:

- Confirm the scan name, tenant, subscription list, date range, and scan ID.
- Read every collector warning and identify incomplete coverage.
- Verify that `$` and `_usd` values represent `CostUSD`, `CostInUsd`, or an
  Azure-quoted USD benefit; do not combine source currencies manually.
- Validate ownership before removing a resource or role assignment.
- Treat inferred idle, right-sizing, and commitment results as investigation
  leads; confirm workload seasonality and business requirements.
- Store exported access matrices according to your organization's security and
  privacy policy.
- Rotate service principal credentials through your secret manager, never in a
  prompt or report.
- Obtain normal change approval outside this plugin before remediation.

The current plugin ends at evidence and recommendations. Remediation automation
is deferred and no tool in this workflow applies changes to Azure.

## 13. Validate the plugin itself

From the repository root, run the offline self-test:

```bash
node plugins/azure-governance/selftest.mjs
```

The self-test uses mocks and fixtures; it does not access or modify your Azure
tenant. A green self-test validates the local tool contracts, but it does not
prove that your Azure identity has permission to collect every optional source.
