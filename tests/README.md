# Test Layout

## Purpose
This directory is the refactor-safe test backbone for LocalAgent.

The goal is to catch seam breakage before large modules are split:
- renderer bridge drift
- widget DOM drift
- plugin lifecycle regressions
- MCP registry regressions
- knowledge safety regressions
- file-size budget regressions

## Suites
- `npm run test:contracts`
  Static and contract-level checks. Fastest signal.
- `npm run test:quick`
  Contract suite plus fast legacy integration scripts.
- `npm run test:skin`
  Headless skin and theme compatibility checks only.
- `npm run test:core`
  Quick suite plus deeper local integration checks.
- `npm run test:live`
  Environment-dependent live checks.
- `npm run test:searxng-e2e`
  Windowless Electron end-to-end workflow for plugin runtime via real IPC (enable plugin -> run search tool -> verify results -> disable plugin).
- `npm run test:subagent-external`
  External-test windowless workflow for `subagent` dual-mode validation (`no_ui` + `ui`) with real IPC/event bus.
- `npm run test:subagent-live-search`
  External-test windowless workflow for a real `no_ui` subagent internet search using a live Ollama model and real web tools, with parent-delivery verification.
- `npm run test:subagent-live-time`
  External-test windowless workflow for a real `no_ui` subagent tool call using `current_time`, with child-session and parent-delivery verification.
- `npm run test:all`
  Core plus skin plus live.
- `npm run verify`
  Alias for `test:core`.

## Structure
- `contracts/`
  Refactor guards and interface contracts.
- `helpers/`
  Shared assertions, fakes, and renderer inspection utilities.
- `fixtures/`
  Contract manifests and temporary policy files.

## Rules
1. Add a contract test before splitting a high-risk seam.
2. Keep tests deterministic and local-first.
3. Put live or environment-dependent checks behind explicit suites.
4. If a bug is fixed, add or extend a contract test for it.

## Persistent E2E Motion
When validating plugin workflows in the real app runtime, use the windowless Electron path first:
1. `npm run test:searxng-e2e`
2. Keep command timeout capped at 60 seconds.
3. Test through app IPC handlers, not standalone mock runners.

### External Command Test Mode
For externally driven test orchestration, run:
- `npm run start:test:external`
  - (expands to `electron . --external-test --windowless --external-port 8788`)

Dedicated external tests:
- `npm run test:subagent-external`
- `npm run test:subagent-live-search`
- `npm run test:subagent-live-time`

It exposes a localhost control API:
- `GET /health`
- `POST /invoke` with JSON body:
  - `{"channel":"plugins:list","args":[]}`
  - `{"channel":"plugins:enable","args":["searxng-search"]}`
  - `{"channel":"execute-mcp-tool","args":["plugin_searxng_search_search",{"query":"OpenAI API docs"}]}`
- `POST /shutdown`
