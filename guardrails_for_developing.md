# Development Map for LocalAgent

## Purpose

This file is the stable development map for LocalAgent. It is for future human developers and coding agents who need to add, grow, or reshape features without losing the product behaviors users already depend on.

Use it to answer five questions before changing anything:

1. What part of the system should own this behavior?
2. What storage is the source of truth here?
3. What application behavior should remain stable?
4. What user workflow or expectation should still feel familiar after the change?
5. What test or contract should prove the change is safe?

This is not a user manual and not a ban list. It is an architecture, behavior, and growth document for adding big things without making the app less coherent.

## Product Identity

LocalAgent is a local-first Electron desktop AI agent application with:

- multi-chat sessions
- multiple LLM providers and model/runtime controls
- an MCP-style tool runtime
- file-backed workflows
- persistent agent memory
- pro agents and delegated subagents
- plugins and connectors
- knowledge storage
- background daemons
- a vanilla-JS renderer with a fixed DOM contract

The project is intentionally inspectable. A lot of important runtime state is on disk in `agentin/`, not hidden behind only database rows or opaque caches.

## Core Terms

| Term | Meaning in this repo |
| --- | --- |
| Session | A chat session, usually represented by one chat tab. Stored in `chat_sessions` and `conversations`. |
| Pro agent | A persistent focused agent with its own folder under `agentin/agents/pro/`. |
| Subagent | A specialized worker agent. It can be used as a delegated worker run or opened as its own chat. Invocation mode matters more than label. |
| Tool | A callable backend capability registered in `MCPServer`. |
| Capability group | User-facing tool permission grouping managed by `CapabilityManager`. |
| Workflow | A reusable tool chain, stored primarily as JSON in `agentin/workflows/*.json`. |
| Workflow run | A file-backed execution record under `agentin/workflows/runs/`. |
| Research run | A workflow experiment record under `agentin/research/runs/`. |
| Connector | A worker-thread integration script under `agentin/connectors/`. |
| Plugin | A loadable runtime extension under `agentin/plugins/<id>/`. |
| Knowledge item | A file-backed knowledge folder under `agentin/knowledge/library/` or `agentin/knowledge/staging/`. |
| Session workspace | A per-session temp artifact folder under `agentin/workspaces/<sessionId>/`. |

## How To Read This File

This document uses four different lenses on purpose:

- Application behavior:
  what the system does, what runtime owns it, and what state shape defines it
- UI surface:
  what visible panels, tabs, widgets, dialogs, and controls exist
- UX expectations:
  what the product should feel like from the user side as the UI grows
- User behavior:
  what users actually do in the app and what patterns future changes should continue to support

Keeping these lenses separate matters. A future change can preserve a button while breaking the workflow behind it, or preserve a workflow while making it hard to discover. This file is meant to protect against that kind of drift.

## Growth Principles

- Local-first is a product property, not an implementation detail. New work should keep core behavior usable without turning the app into a remote-only shell unless the product direction explicitly changes.
- The main runtime is service-based. New backend systems fit best when they are registered through `src/main/bootstrap.js` and `src/main/service-container.js`, because that keeps ownership visible and testable.
- The renderer talks to the backend through IPC and `src/renderer/electron-api.js`. Treat that seam as the stable bridge between UI and runtime.
- LLM inference belongs in `src/main/inference-dispatcher.js`. Routing requests through it keeps prompt building, provider selection, and tool-doc injection consistent.
- Tool execution belongs in `src/main/mcp-server.js`. Routing tools through it keeps permissions, inventory, logging, and chaining coherent.
- File-backed runtime state is intentional. Run folders, memory, workflows, prompts, knowledge, plugins, and connectors should stay inspectable on disk wherever possible.
- Contract tests are part of the architecture. When a seam becomes important, give it a test that tells future developers what is safe to change.
- Keep files under the enforced line budget. `tests/contracts/line-budget-contract.test.js` enforces a default max of 1000 lines for tracked source, tests, CSS, HTML, JSON, and Markdown files.
- Default behavior should remain strong when no optional plugin is enabled.

## Runtime Architecture

### High-Level Layering

| Layer | Main files | Responsibility |
| --- | --- | --- |
| Electron entry | `src/main/main.js` | App startup, test/windowless modes, external-test mode, lifecycle shutdown. |
| Bootstrap and DI | `src/main/bootstrap.js`, `src/main/service-container.js` | Build runtime paths, create services, wire dependencies, register IPC, start daemons, create initial window. |
| Window shell | `src/main/window-manager.js` | Create/manage main and auxiliary windows. |
| IPC boundary | `src/main/ipc/register-all-handlers.js` and `src/main/ipc/register-*.js` | Stable boundary between renderer and backend services. |
| LLM runtime | `src/main/ai-service.js`, `src/main/inference-dispatcher.js`, `src/main/providers/*`, `src/main/llm-config.js`, `src/main/llm-state.js` | Provider adapters, model/runtime normalization, system prompt construction, last-working model behavior. |
| Tool runtime | `src/main/mcp-server.js`, `src/main/mcp/register-*.js`, `src/main/capability-manager.js`, `src/main/tool-chain-controller.js` | Tool registration, permission gating, tool chaining, tool inventory, completion tools. |
| Agent runtime | `src/main/agent-manager.js`, `src/main/agent-loop.js`, `src/main/subtask-runtime.js`, `src/main/session-workspace.js`, `src/main/session-init-manager.js` | Agents, subagents, delegated runs, session memory triggers, cold-start detection, temp workspaces. |
| Workflow and research runtime | `src/main/workflow-manager.js`, `src/main/workflow-runtime.js`, `src/main/research-runtime.js` | Workflow CRUD, file-first sync, async runs, baseline vs variant research experiments. |
| Plugin and connector runtime | `src/main/plugin-manager.js`, `src/main/plugin-setup-service.js`, `src/main/connector-runtime.js` | Discover/load plugins, register plugin tools, quick setup, worker-thread connectors. |
| Memory and knowledge runtime | `src/main/agent-memory.js`, `src/main/knowledge-manager.js`, `src/main/background-memory-daemon.js` | Memory files, knowledge tree, background summarization and housekeeping. |
| Background orchestration | `src/main/backend-event-bus.js`, `src/main/background-workflow-scheduler.js`, `src/main/resource-monitor.js` | Typed event relay, background notifications, scheduled workflows, resource gating. |
| Renderer shell | `src/renderer/index.html`, `src/renderer/app.js`, `src/renderer/components/*`, `src/renderer/styles/*` | The desktop UI, chat tabs, settings, widgets, overlays, skins, theme behavior. |

### Request Flow for Normal Chat

1. The renderer sends a message through `window.electronAPI.sendMessage()` from `src/renderer/components/main-panel.js`.
2. IPC handler `send-message` in `src/main/ipc/register-chat-data-handlers.js` persists the user message, marks user activity, and resolves the active session.
3. If tool chaining is enabled, `ToolChainController.executeWithChaining()` runs. Otherwise the message goes straight to `InferenceDispatcher.dispatch()`.
4. `InferenceDispatcher` builds the effective system prompt from:
   - the base system prompt
   - active prompt rules
   - optional tool docs
   - environment/path guidance
   - optional agent system prompt and compacted memory
5. `AIService` routes the request to the active provider adapter.
6. If the model emits tool calls, `ToolChainController` parses them and executes them through `MCPServer.executeTool()`.
7. Tool results are fed back to the model as a structured `<tool_results>` block, with the original user question repeated so the model does not lose intent.
8. Final assistant content is cleaned, persisted to conversation history, and sent back to the renderer.
9. The last working provider/model is remembered in DB state.

### Tool and Permission Flow

- All built-in and plugin tools live in `MCPServer`.
- Permission gating is two-stage:
  - capability group gate via `CapabilityManager`
  - per-tool active state via DB-backed tool state
- If a tool is blocked, the backend returns a permission request instead of silently failing.
- The renderer shows a permission dialog with three user choices:
  - deny
  - allow once
  - enable permanently
- This behavior is part of the product and should remain visible and explicit.

### Event Bus / System Bus

`src/main/backend-event-bus.js` is the system event relay.

It has three jobs:

- route typed events between backend systems
- relay selected events to the renderer
- optionally run an internal LLM decision to determine whether a background notification should be shown

Important design rule:

- the event bus is a notification and routing layer
- the event bus is not the durable storage layer

Durable state still belongs in DB tables or file-backed run folders.

Current event categories include:

- memory
- daemon
- workflow
- chat
- init
- connector
- subagent

### Persistence Model

| Domain | Primary source of truth | Secondary/index state |
| --- | --- | --- |
| Conversations and sessions | SQLite tables in `src/main/database.js` | Renderer tab cache only for UI restore/scroll convenience |
| Settings and provider selection | SQLite `settings` table | LocalStorage only for renderer-only preferences like theme/sidebar collapse/skins |
| System prompt and prompt rules content | Files under `agentin/prompts/` | DB mirrors for active rule state and UI access |
| Workflows | JSON files under `agentin/workflows/*.json` | DB stores stats, search metadata, ids |
| Workflow runs | Run folders under `agentin/workflows/runs/` | DB workflow stats only |
| Research runs | Run folders under `agentin/research/runs/` | Optional knowledge summary in knowledge store |
| Agent memory | Files under `agentin/memory/` | DB not primary here |
| Agents | DB rows plus folder structure under `agentin/agents/` | Renderer widget state only |
| Delegated subtask runs | Run folders under `agentin/subtasks/runs/` and inbox deliveries | Parent delivery may also be mirrored into conversation history |
| Plugins | Files under `agentin/plugins/` | DB stores status/error and `settings` stores plugin config |
| Connectors | Files under `agentin/connectors/` | DB stores connector config |
| Knowledge | File tree under `agentin/knowledge/` | DB is an index and metadata cache |
| Session workspace | Files under `agentin/workspaces/<sessionId>/` | No durable DB ownership |

### Runtime Paths and `agentin/`

`src/main/runtime-paths.js` defines the stable filesystem layout. Reuse those roots when extending the app so storage stays discoverable and consistent.

Important directories:

- `agentin/prompts/system.md`
- `agentin/prompts/rules/`
- `agentin/prompts/templates/`
- `agentin/workflows/`
- `agentin/workflows/runs/`
- `agentin/research/runs/`
- `agentin/subtasks/runs/`
- `agentin/subtasks/inboxes/`
- `agentin/workspaces/`
- `agentin/agents/`
- `agentin/connectors/`
- `agentin/plugins/`
- `agentin/memory/`
- `agentin/knowledge/`
- `agentin/userabout/memoryaboutuser.md`

## The `agentin/` File Model Matters

The project is not purely database-first and not purely code-first. It is deliberately mixed:

- prompts are editable files
- workflows are file-first
- plugins and connectors are file packages
- memory and knowledge are files
- run artifacts are files
- DB is for state, indexing, active selection, stats, and history

Future work should preserve this inspectable mixed model unless there is a strong reason not to.

## How To Build Large Features Here

LocalAgent grows best when a new feature becomes one more well-owned path through the existing runtime, not a parallel mini-app with its own hidden rules.

1. Choose the owner seam first.
   A large feature should usually have one backend owner service and one renderer owner surface.
2. Choose the source of truth early.
   Decide whether the feature is DB-first, file-first, or mixed, and keep everything else as a cache, index, or projection.
3. Reuse the central runtime seams.
   Inference goes through `InferenceDispatcher`, tools through `MCPServer`, renderer access through IPC, and long-lived artifacts under `agentin/`.
4. Make runtime artifacts inspectable.
   If the feature runs over time, creates outputs, or coordinates workers, give it run folders, manifests, or logs that future humans and agents can inspect.
5. Fit it into an existing user workflow.
   Large additions should plug into chat, workflows, widgets, plugins, settings, or agent surfaces in a way that feels native to the app.
6. Freeze the contract you depend on.
   Add or update a focused contract test around the seam that makes the feature safe to extend later.
7. Land incrementally.
   Prefer a narrow first slice with preserved behavior over a rewrite that changes storage, UI, and execution model all at once.

When a feature spans multiple domains, pick one orchestrator and let the other domains stay as dependencies. That keeps ownership obvious.

## Extension Paths

This repo already has strong seams for most work. Anchor new code to the nearest seam so the next increment will also have an obvious home.

- If you add or change a backend service:
  start in `src/main/bootstrap.js`
  register it in `src/main/service-container.js`
  expose it through the appropriate IPC registration file only if the renderer needs it

- If you add or change an IPC endpoint:
  use `src/main/ipc/register-*.js`
  keep `src/main/ipc-handlers.js` as a thin adapter
  preserve existing channel names unless the change is deliberate and migration-safe

- If you add or change a built-in tool:
  use `src/main/mcp/register-*.js`
  update `src/main/tool-classification.json` if capability behavior changes
  update `src/main/tool-groups.json` if UI grouping changes
  update `tests/fixtures/mcp-tool-inventory.json` only when tool inventory changes intentionally

- If you add or change provider/model behavior:
  use `src/main/providers/*`
  normalize behavior in `src/main/llm-config.js` and `src/main/llm-state.js`
  expose settings through `src/main/ipc/register-llm-handlers.js`
  keep `src/renderer/components/api-provider-settings.js` and its contracts in sync

- If you add or change chat/session behavior:
  use `src/main/ipc/register-chat-data-handlers.js`
  check `src/renderer/components/main-panel.js`
  check `src/renderer/components/main-panel-tabs.js`
  check `src/renderer/components/sidebar.js`

- If you add or change delegated subagent behavior:
  use `src/main/mcp/register-agent-tools.js`
  use `src/main/agent-manager.js`
  use `src/main/subtask-runtime.js`
  preserve dual-mode behavior from `subagent-architecture.md`

- If you add or change workflows:
  use `src/main/workflow-manager.js`
  use `src/main/workflow-runtime.js`
  use `src/renderer/components/workflow-editor.js`
  preserve file-first ownership of `agentin/workflows/*.json`

- If you add or change research flows:
  use `src/main/research-runtime.js`
  treat it as a workflow experiment layer, not a replacement for workflows

- If you add or change memory or knowledge behavior:
  use `src/main/agent-memory.js`
  use `src/main/knowledge-manager.js`
  use `src/main/background-memory-daemon.js`
  preserve knowledge line splitting and staged/active safety rules

- If you add or change plugins:
  use `src/main/plugin-manager.js`
  use `src/main/plugin-setup-service.js` for quick-setup style flows
  use `src/main/ipc/register-plugin-knowledge-handlers.js` for renderer access
  use `src/renderer/components/plugin-panel.js` and `plugin-studio-panel.js` for UI

- If you add or change connectors:
  use `src/main/connector-runtime.js`
  use `src/main/mcp/register-connector-tools.js`
  keep secrets/config in DB, not in connector source files

- If you add or change widgets or tabs:
  update `src/renderer/index.html`
  update the owning renderer component
  update DOM contract tests or fixtures if the contract intentionally changes

- If you add or change skins or themes:
  keep `src/renderer/skins/manifest.json`
  keep `src/renderer/skins/contract.json`
  keep theme persistence in `src/renderer/app.js`
  keep required DOM ids stable so compatible skins continue to work

## Stable Behaviors To Build On

These are stable product behaviors that future work should compose with. They are not here to freeze the app; they describe the shape that makes new features feel like LocalAgent instead of a sidecar tool.

### Chat and Session Behavior

- Multi-chat is a core product behavior. Each tab is an independent session with its own history.
- Open tabs are restored from settings. Active tab state is persisted.
- Per-tab scroll position and rendered HTML are cached in the renderer for fast switching.
- A regular chat tab clear is not the same as delete:
  - clear creates a fresh session for the tab
  - the previous session remains in recent history
- Agent and subagent chat tabs clear in place instead of spinning up a fresh regular session.
- Sending is asynchronous. The UI shows a loading message and stop button, but input stays usable.
- Context usage belongs in the chat bar and should continue to reflect actual response usage.

### Tool Runtime Behavior

- Tool inventory changes are contract-sensitive.
- Safe tools should remain usable when the main capability switch is on.
- Unsafe or disabled tools must surface permission flow instead of silently bypassing policy.
- Tool calls in the model transcript are syntax-driven. The backend parses `TOOL:name{...}` exactly.
- `end_answer` and completion tools are part of the chain-completion contract and should not be treated as normal user-visible tools.

### Agent and Subagent Behavior

- Invocation mode determines subagent behavior, not the label alone.
- Delegated subtask runs must create inspectable run folders with:
  - `request.json`
  - `status.json`
  - `result.json`
  - `messages.jsonl` or equivalent trace
  - artifacts and workspace paths
- Delegated runs must auto-deliver a structured result back to the parent session when possible.
- Direct user-opened subagent chats are first-class chats, not hidden worker runs.
- Subagent UI mode should be able to surface a child chat tab and lifecycle pulses.
- No-UI subagent mode should remain backend-only and not pollute the visible chat surface unless explicitly surfaced.

### Workflow Behavior

- Workflows are file-first. JSON files in `agentin/workflows/` are the source of truth.
- DB workflow rows are for stats and searchability, not the primary definition.
- Workflow capture must validate tool names against current tool inventory.
- Workflow run mode can be `sync`, `async`, or `auto`.
- Auto mode should continue choosing async for longer or clearly asynchronous chains.
- Workflow runs should stay inspectable via run folder manifests, trace, and results.

### Research Behavior

- Research runtime is built on top of workflows, not beside them.
- A research run should compare a baseline workflow and variants, score them, produce a ranking, and write a final report.
- Auto-save to knowledge is part of the current design and should remain optional but supported.

### Plugin Behavior

- Plugin enable must register handlers and plugin tools immediately.
- Plugin disable must remove plugin-owned handlers and tool registrations cleanly.
- Failed plugin enable must roll back partial registrations.
- Plugin config is stored in namespaced settings like `plugin.<id>.*`.
- Enabling a plugin auto-generates a knowledge item that explains the plugin to the LLM.
- The default plugin tool name format `plugin_<pluginId>_<handler>` is part of the current discoverability model.

### Connector Behavior

- Connectors are worker-thread integrations, not in-process arbitrary hooks.
- Connector config belongs in DB, not in the connector JS file.
- `connector_op` is the current MCP-facing management seam.
- Connector start/stop/log behavior should remain observable.

### Knowledge and Memory Behavior

- Memory files are append-oriented and stored by type under `agentin/memory/`.
- Knowledge items are file-backed and line-limited. `KnowledgeManager` splits long content into 200-line chunks.
- Knowledge safety matters:
  - staged items can be confirmed or rejected
  - active knowledge cannot be treated like rejectable staged knowledge
- The `explore_knowledge` tool is how the LLM discovers the knowledge tree before reading files.

### Background Behavior

- Background daemons should stay secondary to active user chatting.
- Background work is resource-gated.
- Memory daemon is inference-driven and escalating in schedule.
- Workflow scheduler is deterministic and fixed-interval.
- Background automation should feel supportive, not intrusive or random, in the foreground chat experience.

### Provider and Runtime Behavior

- Provider selection, model selection, context window, reasoning visibility, and request overrides are part of the supported configuration surface.
- Explicit active provider/model selection should take effect immediately.
- Tested custom models can be remembered as workable.
- Last working provider/model is an intentional fallback path and should be preserved.
- Provider adapters normalize reasoning/thinking output into a common shape for the renderer.

### Renderer and Skin Behavior

- The renderer is plain script-loaded JavaScript, not a bundled SPA framework.
- Components rely on global instances such as `window.mainPanel`, `window.sidebar`, and `window.electronAPI`.
- Script order in `src/renderer/index.html` matters.
- DOM ids are contracts. Many components query fixed ids directly.
- Compatible skins must preserve required ids from `src/renderer/skins/contract.json`.
- Theme and skin preferences are user state and must persist.

## UI Surface Map

The UI is not one screen. It is a collection of stable surfaces.

### Left Sidebar

- application logo
- navigation tabs:
  - Chat
  - Settings
  - MCP
  - Workflows
  - LLM Settings
  - API Providers
  - Tool Activity
- capability panel with:
  - master tools toggle
  - group toggles
  - file mode cycle `off/read/full`
- recent chats list
- shortcuts button
- stats button

### Center Chat Surface

- multi-tab chat strip
- add-tab button
- per-tab clear brush
- per-tab close button
- context usage summary
- messages timeline
- provider select
- model select
- file attach button
- voice input button
- auto-speak toggle
- send and stop controls
- drag-drop zone for files

### Settings Tab

- app settings placeholders
- privacy delete-all-conversations flow
- experimental skin system
- skin diagnostics

### MCP Tab

- tool tester
- available tools list
- recent tool activity

### Workflows Tab

- workflow name field
- new/save/run controls
- node palette
- visual canvas
- zoom controls
- saved workflows panel

### LLM Settings Tab

- editable system prompt
- prompt rule list
- add/toggle/delete rule controls

### API Providers Tab

- provider chooser
- model chooser
- discover models
- provider-specific connection fields
- custom model test flow
- context window slider or read-only context info
- model runtime settings
- save configuration

### Right Widget Panel

- theme picker
- calendar
- plugins widget
- agent picker
- recent workflows widget

### Overlays and Dialogs

- delete-all confirmation
- tool permission dialog
- plugin studio
- calendar add-event modal
- agent create/edit modal

## UX Expectations

This section is about application behavior from the user’s perspective, not just file ownership.

- The app should feel like one coherent desktop tool, not a bag of unrelated panels.
- Chat must remain the center of gravity.
- Settings panels should support chat, not replace it.
- User actions should be explicit for risky operations:
  - tool enablement
  - unsafe tools
  - plugin toggles
  - delete flows
- Background behavior should inform, not interrupt.
- The UI should preserve continuity:
  - open tabs restored
  - theme restored before scripts finish booting
  - skin preferences restored
  - provider/model state visible
- Visual customization is real user value. The skin system is experimental, but it is not fake or decorative-only.
- The workflow editor should feel like a real builder, not just a hidden JSON generator.
- Plugin management should remain discoverable from both the widget and the full studio overlay.
- Capability controls should remain understandable at a glance. The user should know when tools are available, blocked, or need elevation.
- Model/runtime controls should remain compact but powerful. The current UI intentionally supports:
  - provider discovery
  - custom model testing
  - context window tuning
  - reasoning visibility
  - request override editing
- Tool results and background events should enrich chat, not create unreadable noise.

## User Behavior Patterns To Preserve

This section is different from UX. It describes how users actually behave in the app and what future development must continue to support.

- Users work in multiple chat tabs at once for separate topics.
- Users return later and expect those tabs, titles, and histories to still make sense.
- Users clear a tab because they want a fresh conversation, not because they want the old session erased from history.
- Users open agent chats from the widget as dedicated working contexts.
- Users delegate to subagents and expect either:
  - an invisible worker run
  - or a visible child chat
  depending on invocation mode.
- Users enable and disable tool groups as a safety and control habit, not as a rare debugging feature.
- Users inspect MCP tools directly in the MCP tab instead of trusting invisible automation.
- Users try models that may not be in provider discovery results and expect workable custom models to be remembered.
- Users use the calendar both as an event display and as a date filter for chat history.
- Users use workflows in two different ways:
  - visually from the workflow editor
  - operationally through chat/tool execution
- Users use plugin toggles from the small widget for quick control and the studio for detail/config/discovery.
- Users use drag-and-drop attachments, voice input, and speak-back as convenience tools around normal chat.
- Users rely on recent activity widgets and tool badges to orient themselves quickly.
- Advanced users may inspect workspace files and run folders directly on disk. These folders are not an internal implementation detail only.

## Plugins and Connectors as Extension Paths

Plugins and connectors are how the product grows without forcing every capability into core. Treat them as first-class extension paths, not as exceptions.

### Plugins

- A plugin currently means a package under `agentin/plugins/<plugin-id>/`.
- `plugin.json` plus `main.js` is the active contract.
- Plugin loading is owned by `PluginManager`.
- Plugins register tool handlers through `context.registerHandler()`, which keeps inventory, lifecycle, and rollback behavior coherent.
- Plugin enable/disable should remain hot-load friendly during development.
- Plugin rollback on enable failure is mandatory.
- Plugin knowledge generation is not optional decoration. It is part of LLM discoverability.
- Renderer-facing plugin control should continue to use the plugin IPC layer so UI state and runtime state stay aligned.

### Connectors

- Connectors are still a distinct runtime concept from plugins.
- They live in `agentin/connectors/` and run in worker threads.
- They are integration-oriented and config-driven.
- Future plugin evolution may absorb some connector-like behavior, but current connector flows must keep working.

### Quick Setup

- `src/main/plugin-setup-service.js` currently provides quick setup for the bundled SearXNG plugin.
- Quick setup should create or ensure the plugin package, rescan, enable it, and optionally focus it in the studio.
- If quick setup expands to more plugin types, keep the same pattern: scaffold, validate, rescan, enable, focus.

## Testing and Verification

Testing is a design tool here, not just a release checkbox. The goal is to let the app grow while making the important seams explicit.

### Test Structure

| Suite | Entry point | Purpose |
| --- | --- | --- |
| Contracts | `node tests/run-suite.js contracts` | Fast seam checks and non-regression contracts. |
| Quick | `node tests/run-suite.js quick` | Contracts plus lightweight command-based checks. |
| Core | `node tests/run-suite.js core` | Quick plus deeper local integration checks. |
| Skin | `node tests/run-suite.js skin` | Headless skin/theme compatibility path. |
| Live | `node tests/run-suite.js live` | Environment-dependent checks like live provider access. |
| External | `npm run start:test:external` plus dedicated tests | Windowless Electron runtime controlled through HTTP IPC bridge. |

### What Contract Tests Already Protect

- chat tab UI semantics
- chat user active/idle event behavior
- provider and model selection behavior
- provider reasoning extraction normalization
- built-in MCP tool inventory
- plugin lifecycle rollback and auto-enable
- knowledge safety around staged vs active items
- subagent tool and delegated-run contracts
- workflow runtime sync/async behavior
- research runtime result contract
- theme persistence
- skin state persistence and dev control visibility
- DOM id contracts for widgets
- line budget enforcement

### Development Testing Rules

- Prefer targeted, fast verification first.
- Start with the narrowest test that proves the seam instead of defaulting to a broad blocking suite.
- If you change a protected contract intentionally, update the contract test and the fixture in the same change so the new behavior is explicit.
- If you split a risky file or move ownership between modules, add or extend a contract test first.
- Windowless and external-test modes are the preferred real-runtime path for plugin, subagent, and integration checks.

## Modularity Strategy

Modularity in this project is not only about cleanliness. It is how future coding agents stay effective and how large features remain shippable.

- Modules should be domain-owned, not “misc utility” owned.
- A new feature should usually have one clear owner service on the backend and one clear owner component on the renderer.
- Avoid sideways dependencies where renderer components start reimplementing backend rules.
- Avoid duplicate state models when one source of truth already exists.
- Prefer explicit registration points:
  - service registration in bootstrap
  - IPC registration in `register-*.js`
  - tool registration in `mcp/register-*.js`
  - plugin registration through `PluginManager`
- If a file is growing fast, split by domain or responsibility before it hits the line budget ceiling.
- New files should target well under 1000 lines so they have room to grow.

## Continuous Development Approach

- Favor additive and incremental evolution over big-bang rewrites unless the project is explicitly paused for migration.
- Preserve existing public contracts while refactoring:
  - IPC channel names
  - tool names
  - tool payload shapes
  - DOM ids
  - run folder contract files
  - plugin tool naming
- Keep default behavior stable when no plugins are enabled.
- Use file-first inspectability as a feature. Important runtime artifacts should stay easy to inspect.
- Respect current renderer architecture:
  - vanilla JS
  - global singletons
  - script tag order
- If the renderer ever moves to a different architecture, treat it as a planned migration with compatibility thinking rather than an opportunistic partial rewrite.
- If persistence rules change, include migration logic and backward compatibility thinking.
- Update this file when the architecture or invariants materially change.

## Growth Direction

The current codebase already moved toward smaller domain modules, but the long-term direction should stay consistent:

- core remains the default path
- plugins remain optional capability layers
- file-backed contracts stay readable
- runtime seams get smaller and clearer over time
- refactors land incrementally with parity checks

In other words:

grow LocalAgent by strengthening the existing boundaries and extension paths.
avoid hidden alternate stacks that future work will have to rediscover.

## Expansion Checklist

Before merging any meaningful change, check these questions:

1. Which domain is the primary owner of this change?
2. Did I put the change in the correct owner file or module?
3. Did I preserve the current source of truth for this domain?
4. Which application behavior, UX expectation, and user behavior pattern does this touch?
5. Did I keep tool, IPC, DOM, and run-folder contracts stable, or intentionally update their tests and fixtures?
6. If I added a new tool, plugin, workflow, provider capability, widget, or storage shape, did I update its inventory, config, discovery path, and tests?
7. If the change spans multiple domains, is there one clear orchestrator?
8. If I touched a risky seam, did I add or update a contract test?
9. Did I keep files within the line budget?
10. If I changed architecture, did I update this document so the next developer or coding agent can continue cleanly?
