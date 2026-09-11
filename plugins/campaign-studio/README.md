# Campaign Studio

Campaign Studio is a Bahulam plugin for content/ad operations. It plans,
creates, approves, schedules, and tracks cross-channel campaigns through an
entry agent, helper agents, deterministic tools, durable SQLite state, and a
live workspace panel.

This is intentionally not a "generate tweets" sample. It is a moat-level plugin
example: the value is the outcome runtime and learning loop.

## Install

```bash
bahulam install campaign-studio
bahulam plugin campaign-studio .
```

## What It Provides

- Entry agent: `campaign-studio`
- Helper agents: `brand-compliance-reviewer`, `growth-analyst`
- Tools: `campaign_create`, `copy_variant_create`, `approval_record`,
  `post_schedule`, `metrics_record`, `campaign_report`
- State: campaigns, variants, approvals, posts, metrics, campaign activity
- UI: campaign board, variants, scheduled posts, activity stream

## Example

Ask Bahulam:

```text
Create a launch campaign for Bahulam plugins. Target engineering leaders.
Create variants for X, LinkedIn, and email, then prepare a simulated schedule.
```

The plugin should create campaign state, write channel variants, schedule
simulated post records, and keep the workspace panel in sync.

## Real Connectors

The default plugin is offline-safe and writes simulated post URLs. Real X,
LinkedIn, Meta, Buffer, or analytics connectors should be added through MCP
servers or hosted adapters with declared env/network requirements.
