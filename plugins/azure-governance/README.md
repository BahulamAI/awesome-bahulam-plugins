# azure-governance

Azure estate analysis runtime for Bahulam plugins.

## Start here

New to this plugin? Follow the [Azure Governance end-to-end guide](docs/END_TO_END_GUIDE.md).
It covers installation, least-privilege Azure access, authentication, the first
live scan, every analysis tool, report interpretation, recurring reviews, and
troubleshooting.

The shortest supported live workflow is:

```bash
bahulam install azure-governance
az login
az extension add --name resource-graph
bahulam plugin azure-governance .
```

Then ask the Azure Governance workspace agent:

```text
Scan subscription <subscription-id> with Azure CLI, include costs from
<YYYY-MM-DD> through <YYYY-MM-DD>, run the complete governance review, and
produce the executive report.
```

The plugin is read-only. It identifies and reports changes to consider, but it
does not modify Azure resources, role assignments, policies, or billing.

The goal is not just "show my Azure bill." The goal is a complete,
read-only governance workflow where Bahulam can inspect subscriptions,
resource groups, resources, RBAC assignments, exposure, ownership, cost,
and waste, then produce an evidence-backed report.

This plugin keeps offline-safe analysis contracts while also supporting
read-only Azure CLI, Azure Resource Graph, Cost Management, Microsoft Entra,
Policy, Defender for Cloud, and Advisor collection when explicitly requested.

## What it provides

- A primary Azure Governance director agent.
- Access Reviewer and Security Reviewer sub-agents.
- Durable scan and finding state.
- A workspace panel for the governance overview.
- Tool contracts for inventory, cost, RBAC, security, tagging, waste, and
  executive reporting.
- A phased path from local/exported data to full Azure read-only analysis.

## Feature plan

### Phase 1 - Plugin skeleton and offline analysis

Current scope:

- Capture a supplied Azure estate snapshot.
- Analyze cost rows by subscription, resource group, service, region, or tag.
- Build an RBAC access matrix from supplied role assignments.
- Detect public IPs, open management ports, public storage, and Key Vault
  public network access from supplied resource data.
- Audit required tag coverage.
- Detect common waste candidates such as unattached disks, unattached public
  IPs, stopped VMs, and old snapshots.
- Generate a Markdown governance report.
- Run offline selftests without Azure credentials.

### Phase 2 - Azure CLI ingestion

Current scope:

- `az account list`
- `az group list`
- `az resource list`
- `az role assignment list --all`
- Optional `az account tenant list`
- Optional `az consumption usage list` when `include_costs` is true
- `az graph query` with paging across selected subscriptions for richer
  resources, role definitions, Policy assignments/states, Defender
  assessments and secure scores, regulatory compliance, and Advisor.

The CLI collector uses the Cost Management REST query API when
`include_costs` is true and falls back to `az consumption usage list` when
that query is unavailable.

Resource Graph is enabled by default and falls back to `az resource list` if
the CLI extension is unavailable. Set `use_resource_graph: false` to force the
basic path or `graph_page_size` to control pages up to 1,000 rows.

The plugin should remain read-only. If `az` is not installed or the user is
not logged in, tools should fail with clear setup guidance.

### Phase 3 - Azure SDK and Resource Graph

Current scope:

- Authenticate with `DefaultAzureCredential`.
- Query Azure Resource Graph across subscriptions.
- Normalize resources, resource groups, tags, locations, SKUs, and
  dependency fields.
- Support management group and multi-subscription scope selection.
- Cache scan payloads so reports remain reproducible after Azure changes.
- Capture Azure Policy compliance states, Defender for Cloud assessments,
  and Azure Advisor recommendations when Resource Graph exposes them.
- Enrich assignments with Resource Graph role definitions.
- Optionally resolve Microsoft Entra principal names and status through
  Microsoft Graph when `include_principals` is true and `Directory.Read.All`
  is available.

### Phase 4 - Cost Management and optimization

Current scope:

- Cost by subscription, resource group, service, region, meter, SKU, and tag.
- Cost Query uses `CostUSD`; Cost Details uses `CostInUsd`. Non-USD source
  amounts are retained as source evidence but are never mislabeled as dollars.
- Daily burn rate and month-end forecast.
- Top cost drivers.
- Untagged spend.
- Cost anomaly detection.
- Idle-but-expensive resources.
- Reserved Instance and Savings Plan screening candidates based on sustained,
  stable daily usage.
- Azure Advisor and utilization-based right-sizing recommendations.
- Asynchronous Cost Details ingestion with full multi-dimensional billing rows
  and `CostInUsd` normalization.
- Native reservation and Savings Plan recommendations with Azure-quoted dollar
  savings and hourly commitments.
- Azure Monitor metrics for VM, database, App Service, AKS, and Storage
  right-sizing evidence.

### Phase 5 - RBAC, identity, and access review

Current scope:

- Role assignments at management group, subscription, resource group, and
  resource scope.
- Direct user assignments versus effective group-based access when group
  membership evidence is collected or supplied.
- Owner, Contributor, User Access Administrator, and custom privileged roles.
- Service principals and managed identities with broad reach.
- Deleted, unknown, inactive, or stale principals.
- Principal-centric reports: "what can this identity access?"
- Scope-centric reports: "who can access this resource group?"
- CSV/Markdown access matrix export.
- Azure RBAC Privileged Identity Management eligible, active, and time-bound
  assignments.
- Service principal password/certificate expiry and federated identity review.
- Native user sign-in activity and optional service principal sign-in activity.

### Phase 6 - Security, policy, and compliance

Current scope:

- Azure Policy assignments, disabled enforcement, and non-compliant resources.
- Defender for Cloud recommendation summary.
- NSG and firewall exposure.
- Storage public access.
- Key Vault access and public network settings.
- SQL/Postgres/MySQL firewall rules.
- Missing diagnostic settings.
- Missing locks on production resource groups.
- Missing private endpoints for sensitive services.
- Policy compliance score for the estate, subscriptions, resource groups,
  and policy assignments.
- Defender for Cloud secure score and regulatory-compliance standards.
- Subscription activity-log diagnostic export coverage.
- Service-specific TLS, secure transfer, infrastructure encryption, local
  authentication, container registry admin, and AKS RBAC controls.

Diagnostic settings and resource-group locks are collected through read-only
Azure Resource Manager calls when `include_governance_details` is true.
Missing-control findings are coverage-aware, so incomplete collection does not
silently produce missing diagnostic-setting or lock findings.

Phase 4, Phase 5, and Phase 6 enhancement scope is complete. Live enrichment
is opt-in so tenants can grant only the permissions needed for each review.

### Phase 7 - Workspace and reports (deferred)

Deferred at the user's request. No Phase 7 implementation is currently active.
The parked scope is:

- Estate overview dashboard.
- Subscription and resource group drill-down.
- Cost heatmap.
- Access matrix.
- Public exposure view.
- Tag coverage score.
- Recommendations board grouped by save money, reduce access, fix security,
  improve ownership, and clean waste.
- Export reports to Markdown, JSON, and CSV.

### Phase 8 - Optional remediation planning (deferred)

Deferred at the user's request. If resumed, remediation must remain
approval-gated:

- Generate Azure CLI or Bicep/Terraform suggestions.
- Never apply changes by default.
- Require explicit approval for any future write operation.
- Record all proposed and approved actions in plugin state.

## Tools

| Tool | Purpose |
|---|---|
| `azure_inventory_scan` | Capture a supplied snapshot or collect read-only Azure inventory, detailed cost, metrics, RBAC/PIM, Entra identity, Policy, Defender, Advisor, diagnostics, and locks. |
| `azure_resource_group_report` | List resource groups from a stored scan with subscription, location, tags, resource count, and resource types. |
| `azure_cost_report` | Analyze dollar spend with forecasts, anomalies, metric-backed right-sizing, inferred commitment candidates, and separate Azure-quoted reservation/Savings Plan savings. |
| `azure_access_matrix` | Review direct, group-derived, and PIM access, stale identities, expiring application credentials, federation, and sign-in evidence; export CSV or Markdown. |
| `azure_security_findings` | Detect exposure and service configuration risks, missing governance controls, Policy non-compliance, secure score, and regulatory posture. |
| `azure_tag_audit` | Check required ownership/governance tags on resources and resource groups. |
| `azure_waste_report` | Find likely waste such as unattached disks, unattached public IPs, stopped VMs, and old snapshots. |
| `azure_governance_report` | Build an executive Markdown report from the scan and recorded findings. |

## Requirements

### Current offline MVP

- Node.js available through the Bahulam runtime.
- No Azure credentials required.
- Supply exported/synthetic Azure scan data through `azure_inventory_scan`.

### Azure CLI collection

Recommended local requirements:

- Azure CLI: `az`
- Azure Resource Graph CLI extension: `az extension add --name resource-graph`
- Azure CLI login: `az login`
- Read permissions across target subscriptions.
- Reader for inventory.
- Role Management Reader, User Access Administrator, or equivalent
  read access for complete RBAC analysis.
- Cost Management Reader or Billing Reader when `include_costs` is true.

The CLI collector currently runs read-only commands:

```bash
az account list --all
az account tenant list
az group list --subscription <subscription-id>
az resource list --subscription <subscription-id>
az role assignment list --all --subscription <subscription-id>
az graph query --graph-query <kusto-query> --subscriptions <subscription-id>
az consumption usage list --subscription <subscription-id> --include-additional-properties
```

`az consumption usage list` is optional because it is a preview Azure CLI
command and may require billing permissions.

### Azure SDK Resource Graph collection

Recommended local requirements:

- Node packages: `@azure/identity`, `@azure/arm-resourcegraph`
- `DefaultAzureCredential` configured through Azure CLI login, managed
  identity, or service principal environment variables.
- Reader for Resource Graph, Policy, and Defender summaries.
- Read access to diagnostic settings and management locks when
  `include_governance_details` is enabled.
- Monitoring Reader or equivalent metrics read access when
  `include_monitor_metrics` is enabled.
- Cost Management Reader or Billing Reader when `include_cost_details` or
  `include_benefit_recommendations` is enabled.
- `Microsoft.Authorization/roleAssignments/read` at each selected scope when
  `include_pim` is enabled.
- `Directory.Read.All` only when `include_principals` is enabled.
- `GroupMember.Read.All` or `Directory.Read.All` when
  `include_group_memberships` is enabled.
- `Application.Read.All` when `include_identity_details` is enabled.
- `AuditLog.Read.All` for native user sign-in activity. Optional service
  principal sign-in activity uses the Microsoft Graph beta report when
  `include_service_principal_sign_ins` is enabled.

Install optional SDK packages when using `collect_from: "azure_sdk"`:

```bash
npm install @azure/identity @azure/arm-resourcegraph
```

The SDK collector currently runs Azure Resource Graph queries for inventory,
RBAC assignments, Policy compliance states, Defender assessments, and Advisor
recommendations. When `include_costs` is true and `@azure/arm-costmanagement`
is installed, it also queries Cost Management usage by subscription or
management group scope. Cost Management accepts at most two grouping clauses,
so `cost_dimensions` selects up to two dimensions for each scan. When
`include_principals` is true, the collector resolves up to 1,000 directory
object IDs per Microsoft Graph request. Set both `include_principals` and
`include_group_memberships` to resolve assigned groups and expand their
transitive members into effective access paths. `group_membership_limit`
defaults to 5,000 member records per scan.

Set `include_governance_details` to collect diagnostic settings for sensitive
resource types, subscription activity-log diagnostic settings, and management
locks for resource groups through Azure Resource Manager.

Set `include_cost_details` for asynchronous Cost Details rather than aggregated
Cost Query rows. Set `include_benefit_recommendations` for Azure-native Savings
Plan and reservation quotes, and `include_monitor_metrics` for metric-backed
right-sizing. `include_pim` collects eligible and active Azure RBAC schedules.
`include_identity_details` collects application credentials, federated identity
credentials, and user sign-in activity. Every optional source records coverage
and warnings in the persisted scan.

Optional SDK packages:

```bash
npm install @azure/arm-costmanagement @azure/arm-authorization @azure/arm-policyinsights
```

Environment variables used by `DefaultAzureCredential` when service principal
or managed identity authentication is selected:

| Variable | Purpose |
|---|---|
| `AZURE_TENANT_ID` | Default tenant scope. |
| `AZURE_SUBSCRIPTION_ID` | Default subscription scope. |
| `AZURE_CLIENT_ID` | Service principal or managed identity client id. |
| `AZURE_CLIENT_SECRET` | Service principal secret. |
| `AZURE_CLIENT_CERTIFICATE_PATH` | Certificate auth path. |

Do not put secrets in prompts, manifests, README examples, or workspace views.

## Example prompts

```text
Analyze this exported Azure estate snapshot. Show cost by resource group,
privileged access, public exposure, missing owner tags, and likely waste.
```

```text
For the latest Azure scan, tell me which resource groups have high cost,
Owner or Contributor assignments, and public internet exposure.
```

```text
Create an executive Azure governance report with the top risks and the first
five cleanup actions we should take.
```

## Example offline workflow

```text
azure_inventory_scan {
  name: "demo estate",
  tenant_id: "tenant-001",
  subscriptions: [{ id: "sub-001", name: "Production" }],
  resource_groups: [{ name: "rg-prod-app", subscription_id: "sub-001", tags: { environment: "prod" } }],
  resources: [
    { id: "/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Network/publicIPAddresses/pip-web", name: "pip-web", type: "Microsoft.Network/publicIPAddresses", properties: { ipAddress: "20.1.2.3" } },
    { id: "/subscriptions/sub-001/resourceGroups/rg-prod-app/providers/Microsoft.Compute/disks/orphan", name: "orphan", type: "Microsoft.Compute/disks" }
  ],
  role_assignments: [
    { principal: "alice@example.com", principal_type: "User", role: "Owner", scope: "/subscriptions/sub-001" }
  ],
  costs: [
    { subscription_id: "sub-001", resource_group: "rg-prod-app", service: "Virtual Machines", cost: 1200.50 }
  ]
}

azure_cost_report { group_by: "resource_group" }
azure_access_matrix {}
azure_security_findings {}
azure_tag_audit { required_tags: ["owner", "environment", "costCenter", "application"] }
azure_waste_report {}
azure_governance_report {}
```

## Example Azure CLI workflow

```text
azure_inventory_scan {
  name: "live estate",
  collect_from: "azure_cli",
  subscription_ids: ["00000000-0000-0000-0000-000000000000"],
  include_costs: true,
  cost_start_date: "2026-09-01",
  cost_end_date: "2026-09-23"
}

azure_security_findings {}
azure_access_matrix {}
azure_tag_audit { required_tags: ["owner", "environment", "costCenter", "application"] }
azure_waste_report {}
azure_governance_report {}
```

## Example Azure SDK Resource Graph workflow

```text
azure_inventory_scan {
  name: "resource graph estate",
  collect_from: "azure_sdk",
  subscription_ids: ["00000000-0000-0000-0000-000000000000"],
  management_group_ids: ["contoso-root"],
  include_cost_details: true,
  include_benefit_recommendations: true,
  include_monitor_metrics: true,
  include_principals: true,
  include_group_memberships: true,
  include_pim: true,
  include_identity_details: true,
  include_governance_details: true,
  cost_start_date: "2026-09-01",
  cost_end_date: "2026-09-23"
}

azure_security_findings {}
azure_access_matrix {}
azure_tag_audit { required_tags: ["owner", "environment", "costCenter", "application"] }
azure_waste_report {}
azure_governance_report {}
```

## Runtime direction

The local OSS plugin should keep stable Bahulam contracts and state. Azure
collection can evolve behind those contracts:

```text
azure_inventory_scan -> Azure CLI / SDK Resource Graph collectors
azure_cost_report    -> Cost Management query API
azure_access_matrix  -> Authorization role assignment API + Entra enrichment
azure_security_findings -> Resource Graph + Defender + Policy signals
```

Hosted SaaS, CLI, Desktop, and MCP implementations should expose the same tool
names and output shapes so reports and workspace views stay portable.

## Test

```bash
node plugins/azure-governance/selftest.mjs
```
