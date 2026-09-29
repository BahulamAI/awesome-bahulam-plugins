---
name: azure-cost-investigation
description: Investigate Azure spending, identify material drivers, and recommend safe cost actions using the Azure Cost Analyzer plugin. Findings are backed by recorded tool runs a reader can check.
---

# Azure cost investigation

Use this skill when the user asks to understand, reduce, forecast, or explain Azure spend.

## Safe investigation order

1. Confirm the requested billing window and the currency shown by the plugin.
2. Start with `azure_cost_by_service` to identify the largest cost drivers.
3. Use `azure_cost_trend` to distinguish a sustained increase from a one-off spike.
4. Use `azure_cost_by_dimension` or `azure_resources_by_type` to narrow a material driver by region, resource group, tag, or resource type.
5. Check `azure_budget_alerts` before recommending a priority or escalation.

## Presenting findings

- State the window, currency, and whether values are actual, estimated, or forecast.
- Separate observed evidence from a proposed action.
- Rank recommendations by expected impact, confidence, operational risk, and likely owner.
- Prefer reversible actions first: remove clearly orphaned resources, right-size after utilization is confirmed, and use schedules where downtime is acceptable.
- Never claim a saving is guaranteed. Note the data or utilization measurement required to validate it.


## What the plugin records, and what the panel shows

Every cost tool writes what it read into this plugin's own SQLite state before
returning: one row in `cost_runs` carrying the capture time, the tool, the scope
and the currency, and one row per figure in `cost_rows`. The "Azure Cost" panel
reads those tables and nothing else, so a reader can check any number you quote
against the run it came from.

You do not write that state and you cannot shape the panel. The tools record it
as a side effect of answering, and the panel renders it deterministically. This
is a deliberate boundary — there is no agent-authored layout here.

What it means for how you answer:

- **Quote figures you actually read.** A number you computed in your head has no
  run behind it, so a reader who opens the panel cannot find it. If you derive
  something — a projection, a percentage, a difference — say so and say which
  runs it came from.
- **Money is stored in integer minor units** with the currency's exponent beside
  it. The panel formats it back. Nowhere in your answer should a figure be
  presented to more precision than the tool returned.
- **A run is scoped to a subscription and a window.** Two runs with different
  windows are not comparable, and saying so is part of the answer.
- **Re-running a tool adds a run; it never replaces one.** So "I re-checked and
  it changed" is a claim the panel can substantiate. Prefer re-running over
  reasoning about stale output.
- **If the panel is empty, no tool has run yet.** That is the honest state, not
  a fault to work around.

## Guardrails

- Do not expose, request, echo, or place service-principal credentials in chat, recorded state, artifacts, or tool arguments. The plugin reads configured credentials locally.
- Do not present a figure the panel cannot corroborate. Every number a reader can check comes from a recorded run; anything else must be labelled as derived, with its inputs named.
- Do not delete, stop, resize, reserve, or change Azure resources unless a separately authorized action tool is available and the user explicitly approves it.
- If credentials are missing or data is unavailable, explain the prerequisite and offer a read-only next step.
