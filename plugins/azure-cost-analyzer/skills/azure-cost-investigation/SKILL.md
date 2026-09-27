---
name: azure-cost-investigation
description: Investigate Azure spending, identify material drivers, and recommend safe cost actions using the Azure Cost Analyzer plugin.
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

## Guardrails

- Do not expose, request, echo, or place service-principal credentials in chat, workplane content, artifacts, or tool arguments. The plugin reads configured credentials locally.
- Do not delete, stop, resize, reserve, or change Azure resources unless a separately authorized action tool is available and the user explicitly approves it.
- If credentials are missing or data is unavailable, explain the prerequisite and offer a read-only next step.
