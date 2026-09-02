# redmine-studio

Redmine ops Studio for Bahulam. A vertical AI pack that composes
[`pi-redmine`](https://www.npmjs.com/package/pi-redmine)'s 11 REST tools
with Bahulam's persistent-state layer and a live workspace panel.

## What this demonstrates

The **composition model** end-to-end:
- **Ingredients**: pi-redmine's Redmine REST wrappers (list projects, search
  issues, create/update tickets, log time, wiki pages)
- **Our recipe**: a `redmine-analyst` agent that knows the workflow, plus
  three native tools that snapshot important tickets to a persistent store
- **Our kitchen**: shared-blackboard state + reactive canvas — the panel
  shows every snapshot the moment it's persisted, whether the write came
  from the agent (terminal) or the human (panel button)

## Prerequisites

```bash
# 1. Install the pi-redmine package (once)
bahulam plugin install pi:pi-redmine

# 2. Configure Redmine credentials in your shell (pi-redmine reads these)
export REDMINE_URL="https://your-redmine.example.com"
export REDMINE_API_KEY="your-api-key"
# or basic auth
# export REDMINE_USERNAME="you"
# export REDMINE_PASSWORD="secret"
```

## Install & enable

```bash
# From this repo
bahulam plugin install /path/to/awesome-bahulam-plugins/plugins/redmine-studio

# Enable the agent for your project — add to .bahulam/settings.json:
# {
#   "plugins": {
#     "agent_allowlist": ["redmine-analyst"]
#   }
# }
```

## Use

### From the REPL

```bash
bahulam
> /run redmine-analyst "List projects, then show me the last 5 issues in project 'ops', and snapshot any that are High priority."
```

The agent will:
1. Call `redmine.redmine_list_projects`
2. Call `redmine.redmine_list_issues` for the target project
3. Call `save_issue_snapshot` for each High-priority match
4. Open the Studio panel and you'll see rows appear live as each snapshot lands

### From the workspace

```bash
bahulam plugin redmine-studio .
```

Opens the Redmine Studio panel in your browser. You can:
- Enter an issue id → the panel calls `redmine.redmine_get_issue` (composed pi tool) → then `save_issue_snapshot` (our native tool) → the row appears
- Ask the agent from a separate terminal session — the panel updates live via the cross-process fs-watch pulse

## How the composition works

```yaml
spec:
  tools:            # our native, persistent-state tools
    - name: save_issue_snapshot
    - name: list_snapshots
    - name: drop_snapshot
  composes:         # pi ecosystem, stateless REST wrappers
    - source: pi:pi-redmine@^0.2.0
      as: redmine
      expose: [redmine_list_projects, redmine_list_issues, ...]
      verified: true
```

The agent sees a unified toolset (`save_issue_snapshot`, `redmine.redmine_list_projects`, …). pi-redmine runs stateless — it takes an API call, returns JSON. Our layer persists the important results so the workspace panel has something to bind to and the next turn has memory.

## Layout

```
plugins/redmine-studio/
├── plugin.yaml
├── tools/
│   ├── save-issue-snapshot.mjs   # persists to blackboard
│   ├── list-snapshots.mjs        # reads from blackboard
│   └── drop-snapshot.mjs         # deletes from blackboard
├── workspace/
│   └── studio.html               # live panel (SSE-driven, cross-process)
└── README.md
```
