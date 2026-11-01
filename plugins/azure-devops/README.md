# Azure DevOps coworker

## Hosted enterprise OAuth (PRD-117)

Hosted Teams now defaults to the OAuth broker path. Seven hosted PR operations read
PR metadata, iterations, changed paths, source/target files and discussion, propose
an exact comment, and publish it only after human approval in Bahulam. The host
passes `connection.execute(operation, args)` through IPC; the plugin never receives
OAuth tokens, model keys, service credentials or runtime authorization headers.
Organization consent, live membership, billing reservation and per-call scopes are
checked outside the plugin. Setup: `/dashboard/integrations/azure-devops`.

The legacy `connection.request()` and local PAT tooling documented below are
separate capabilities. They are excluded from the hosted runtime tool allowlist.
The local Teams prototype requires explicit `BAHULAM_TEAMS_LEGACY_PAT=true`.
The deployment runbook is in `codekepler-npm/examples/microsoft-teams/HOSTED.md`.
Live Microsoft deployment/consent and Store certification remain release gates.

Azure DevOps tools and an entry agent for organizations using Bahulam infrastructure.
Customers connect their own Microsoft Teams tenant and ADO organization, projects,
and teams. They do not need to create a separate Bahulam agent team.

## Ownership

| Layer | Responsibility |
|---|---|
| Customer organization | Connect Microsoft Teams and ADO, choose projects/teams and authorized users |
| Bahulam infrastructure | Agent runtime, channel authentication, user-to-connection mapping, credential resolution, execution isolation, conversation persistence |
| This plugin | Tool schemas, ADO operations, configuration schema, coworker instructions and action state |

Flow: **Teams user → Bahulam Teams connector → Bahulam agent runtime → plugin tool
+ scoped connection → Azure DevOps → reply in Teams.**

The hosted plugin receives `options.connection = { config, request }`. Configuration
contains organization/project/team routing; `request()` adds authentication inside
Bahulam. The PAT is never passed to the hosted plugin or model. Tools declare their
inputs in `plugin.yaml` and export `call(args, { state, connection, signal })`.
They also work locally using plugin Settings and `state.getConfig()`.

Connection references and non-secret settings belong to a customer's installation.
Credentials belong to Bahulam's connection layer, not the distributable plugin.
The legacy local infrastructure resolves per-user PATs from environment secret
references. Hosted OAuth uses the separate broker described above.

## Install locally

```bash
bahulam install ./plugins/azure-devops
bahulam plugin azure-devops .
```

Configure `organization` (the ADO organization name, not a URL), `project`, optional
`team`, and a user-owned `personal_access_token` in plugin Settings. Never put a PAT
in chat. Local settings are stored in SQLite without application-level encryption;
this local storage is not the enterprise vault. Use the PAT scopes required by the operations enabled for that user:
Work Items Read/Write, Project and Team Read, and optional Build/Code scopes.
Hosted connections supply configuration and authentication through Bahulam instead.

## Tools and examples

| Tool | Example arguments | Behavior |
|---|---|---|
| `ado_context` | `{}` | Show non-secret organization/project/team context |
| `ado_discover` | `{"resource":"members"}` | Projects, teams, members, areas, iterations or work item types |
| `ado_query_work_items` | `{"mine":true,"state":"Active"}` | Project-scoped search using the caller's ADO identity |
| `ado_sprint` | `{}` | Current team sprint, work items, counts by state and owner |
| `ado_get_work_item` | `{"id":42}` | Read an item and return its ADO link |
| `ado_create_work_item` | `{"type":"Bug","title":"Login fails"}` | Create an item; supports assignee, tags, area and iteration |
| `ado_update_work_item` | `{"work_item_id":42,"fields":{"System.AssignedTo":"dev@example.com"}}` | Update fields, assignment or state |
| `ado_add_comment` | `{"work_item_id":42,"text":"Verified in staging"}` | Add a comment |
| `ado_update_comment` | `{"work_item_id":42,"comment_id":7,"text":"Verified in production"}` | Edit a comment |
| `ado_pipelines` | `{"action":"run","pipeline_id":8,"branch":"refs/heads/main"}` | List pipelines/runs or start a requested run |
| `ado_pull_requests` | `{"action":"list","repository":"api"}` | Discover repositories, list/read PRs or create a requested PR |

Projects use continuation tokens; teams/members accept zero-based `page`. Queries
return up to 200 results and indicate when the limit might have truncated results.
Sprint work-item hydration batches requests in groups of 200. Sprint counts are
snapshots, not historical burndown/cycle-time reports. Other list endpoints return
the API's page, not a promise of an exhaustive inventory.

## State and approvals

`ado_actions` records successful writes and proposed work-item changes, linking
back to ADO. Hosted records include organization, actor and conversation attribution.
Audit writes are best-effort: losing an audit row must not turn an already-applied
ADO mutation into a reported failure. This is an activity log, not a compliance ledger.
The existing workspace panel reads the local plugin's state; hosted state is isolated
and is not automatically exposed through that local panel.

Explicit user requests execute directly. For agent-proposed field updates that need
user consent, use `requires_approval: true`. Locally the follow-up uses `approved: true`
after consent. These local flags are conversational controls, not authorization.
Bahulam's Teams host requires the originating user to send a one-use `/approve <id>`
command for the stored exact change in the same conversation; the model cannot set
`approved: true` itself. All ADO authorization still comes from the caller's credential.
Mapped teams select context; ADO area-path permissions remain the ADO administrator's responsibility.

## Hosted integration

Teams connectivity lives in the **Bahulam runtime repository**, not in this plugin:

- `codekepler-npm/src/connectors/microsoft-teams/`: channel handler and runtime wiring
- `codekepler-npm/src/connectors/azure-devops.mjs`: scoped authenticated ADO connectivity
- `codekepler-npm/examples/microsoft-teams/`: infrastructure deployment entry point,
  provisioning example and setup instructions

The initial host runs one registered customer organization and Entra tenant per
process, with explicit per-user/channel mappings. Registration and entitlement checks
must happen in infrastructure provisioning before it installs the binding file.
The plugin does not implement a second user directory, bot server, subscription system,
or model loop. ADO calls use `dev.azure.com`; identity, Teams, and model egress are host-owned.

## Migration status

Implemented locally: core work-item operations, project/team discovery, search, sprint
snapshots, pipelines and PRs, plus the separate Bahulam Teams host. The host uses the
existing Bahulam dispatcher and plugin manifest; no Python agent framework is required.

Not a production cutover or complete parity with ADOIntegration: self-service OAuth,
customer onboarding UI, Marketplace billing, license enforcement, proactive due-date
alerts, historical analytics, enterprise SSO reporting, and advanced bulk/link/delete
operations have not been migrated. Keep the old service running until the intended
customer workflows and credential ownership are validated in a pilot.

## Validation

```bash
node plugins/azure-devops/selftest.mjs
# In the Bahulam runtime checkout:
node test/test-teams-connector.mjs
```

Tests use fake ADO/model responses, plus real plugin manifest parsing, SQLite and
Bahulam graph dispatch in the runtime tests. No real Teams message or ADO mutation
has been sent during development.

The REST contracts follow Microsoft's [work item query API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1)
and [team iteration API](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1).
