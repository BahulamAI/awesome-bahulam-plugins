---
name: azure-cost-investigation
description: Investigate Azure spending, identify material drivers, recommend safe cost actions, and record the review as a Workplane document using the Azure Cost Analyzer plugin.
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


## Recording the review in the Workplane

The workplane tools are the durable output of an investigation. Chat scrolls
away; the document is what the user returns to and shares.

**The tool descriptions are authoritative for mechanics.** `workplane_inspect`
publishes the renderers this panel can draw, each with a working example, plus
the writable state paths and the current revision. Read it rather than guessing,
and rather than trusting anything written here about shapes — this file is
hand-maintained and the catalog is generated from the renderers themselves, so
where they disagree the catalog is right.

What follows is editorial judgement, which the catalog cannot express.

### Scene structure

A cost review reads as a sequence of scenes. A reasonable default:

1. **Overview** — the headline number and the window it covers.
2. **Drivers** — the largest contributors, as a chart plus a detail table.
3. **Trend** — sustained increase versus one-off spike.
4. **Findings and actions** — prose, ranked, with the evidence each rests on.

Add scenes as the investigation earns them. Do not create the empty shells first.

### Write once, then leave it alone

A scene is rendered once. Re-committing the same blocks because the phrasing
could be better churns the document's history and moves the reader's position
for no benefit. Before committing, decide whether this is:

- **new evidence** — add a block, or a scene;
- **a correction** — update the specific block that is wrong;
- **the same thing said differently** — do not commit.

Reordering or restructuring an existing scene is a migration, not an
improvement. Do it when the user asks, not on your own initiative.

### Which block carries which finding

- The headline number is a **metric**, not a sentence containing a number.
- Comparisons and time series are **charts**; the numbers behind them belong in a
  **table** in the same scene, because a reader who distrusts the chart will
  look for the figures.
- Reasoning, ranked recommendations, and caveats are **markdown**. This is where
  the presentation rules above apply — the window, the currency, and whether
  values are actual, estimated, or forecast.
- A number that must not drift out of agreement with the data is a **fact** bound
  to state, not typed into prose.

### Currency and units

Money crosses this boundary in integer minor units, and the catalog says so per
renderer. Two things it cannot tell you:

- The currency comes from Azure's own returned column, never from the configured
  `currency` field. A subscription billed in INR while the config says USD is a
  real and observed condition. If they disagree, say so in the document.
- State the currency where the reader is looking. A table of figures with the
  currency only mentioned two scenes earlier invites a misreading.

### Committing safely

- `workplane_inspect` immediately before committing, so `expectedRevision` is
  current. The panel and the user can commit between your calls.
- One coherent change per commit. Either all of it applies or none does, so a
  commit that mixes a new scene with an unrelated correction fails as a unit.
- A `CONFLICT` means someone else wrote first. Re-inspect, decide whether your
  change still makes sense, and commit with a **new** `commandId`. Replaying the
  old one is a different error.
- Never place a credential, a connection string, or a signed URL in block
  content, a title, or shared state. The document is durable and shareable.

## Guardrails

- Do not expose, request, echo, or place service-principal credentials in chat, workplane content, artifacts, or tool arguments. The plugin reads configured credentials locally.
- Do not author a block whose renderer `workplane_inspect` did not list. It will commit and then render as a placeholder, which reads to the user as a claim you did not deliver.
- Do not delete, stop, resize, reserve, or change Azure resources unless a separately authorized action tool is available and the user explicitly approves it.
- If credentials are missing or data is unavailable, explain the prerequisite and offer a read-only next step.
