# browser-use

Browser form-filling runtime for Bahulam plugins.

The goal is not "the agent has a browser" as a raw capability. The goal is a
visible, approval-gated workflow where users ask Bahulam to complete forms,
review the planned field mapping, and approve any submit-sensitive action.

The entry agent is intentionally tool-first. A delegated form-fill request is
not complete until it records browser evidence. For ordinary URL + field-value
requests, it should call `browser_form_complete` once. The lower-level
session/discover/profile/plan/fill tools remain available for debugging and
step-by-step inspection.

Default handoff is **agent fills, user submits**. The plugin should call
`browser_form_fill` with `submit=false`, `headless=false`, and `keep_open=true`
so the browser remains open for human review. The main/platform agent then asks
the user to click Submit manually if the values look correct.

## What it provides

- A primary Browser Use Operator agent.
- Form Planner and Compliance Reviewer sub-agents.
- Durable state for sessions, form profiles, browser actions, and approval gates.
- A browser workspace panel for the form-fill trail.
- Tool contracts backed by Playwright locally and by the same Playwright
  runtime contract through hosted MCP/Context Forge.

## Example prompt

```text
Open the vendor onboarding form at https://example.com/vendor.
Use the company details from docs/vendor-profile.md, fill every non-sensitive
field, and stop before submit for approval.
```

## Tools

| Tool | Purpose |
|---|---|
| `browser_session_create` | Start a tracked form-fill session. |
| `browser_form_discover` | Inspect the rendered page with Playwright and return controls, buttons, console errors, and screenshot. |
| `form_profile_create` | Store fields, selectors, values, sources, and redactions. |
| `form_fill_plan` | Generate guarded browser actions from a profile. |
| `browser_action_record` | Record completed actions, screenshots, extracts, errors, and approvals. |
| `browser_form_complete` | Fast path: create/reuse session, discover, profile, fill, screenshot, and submit gate in one lifecycle. |
| `browser_form_fill` | Execute the form profile in Playwright, screenshot, and optionally verify localStorage. |
| `browser_session_report` | Summarize session state and pending approval gates. |

## Runtime Direction

This plugin keeps stable Bahulam contracts and state. Bahulam owns the agentic
runtime: planning, state, approvals, handoff, retries, and evidence. Playwright
owns browser execution.

The local OSS plugin uses Playwright directly. Hosted SaaS, Chat, Desktop, CLI,
and mobile integrations should expose the same tool contracts through MCP or
Context Forge backed by an isolated Playwright runtime.

The fastest deterministic path is `browser_form_complete`, which avoids a
multi-tool LLM loop and runs discovery + fill in one browser lifecycle. The
lower-level deterministic Playwright tools use a per-session persistent profile under
`.bahulam/tmp/browser-use/<session_id>/profile`. Discovery and fill can run in
separate tool calls without relying on a still-open CDP connection, while still
sharing cookies, localStorage, and browser session state.

The deterministic adapter maps to Playwright:

```text
browser_open       -> chromium.launchPersistentContext / page.goto
browser_click      -> page.click
browser_type       -> page.fill
browser_extract    -> locator text / DOM snapshot
browser_screenshot -> page.screenshot
```

The hosted SaaS adapter should expose the same tool names and state model
through MCP/Context Forge inside an isolated Playwright browser runtime.

## Test

```bash
node plugins/browser-use/selftest.mjs
```

## Runtime setup

`bahulam install browser-use` installs the plugin's Node dependency from
`package.json` into the installed plugin directory. The real browser executor
also needs the Chromium browser binary:

```bash
cd ~/.bahulam/plugins/browser-use
npm run install-browsers
```

Without Playwright Chromium, deterministic browser tools fail at first browser
launch.
