# Future Plugin System Plan

## Goal
Build a **unified plugin architecture** where almost any capability can be added, enabled, disabled, and upgraded without hard-coding into core app logic.

This is not limited to MCP tools. In this model, all of these can be plugins:
- Messaging integrations (WhatsApp, Telegram, Discord)
- Infra control (Linux server actions, Docker control)
- Dev/operator actions (Codex workflows, repo automation)
- UI panels, skins, commands, workflow packs
- Background jobs and automations

---

## Why This Matters
- Core stays smaller and easier to maintain.
- New capabilities ship as isolated modules.
- Risky features can be sandboxed and permission-gated.
- Teams can build plugins independently without touching core internals.

---

## Core Design Principles
1. Everything optional should be a plugin.
2. Plugin boundaries are explicit: manifest, permissions, lifecycle, API contracts.
3. Security first: least privilege, capability gating, isolation by execution type.
4. File-first developer experience with DB-backed runtime state.
5. Backward compatible migration from existing connectors/tools/workflows.

---

## Plugin Taxonomy (What Can Become a Plugin)
### 1) Integration Plugins
Examples:
- `whatsapp-bridge`
- `github-events`
- `jira-sync`

Responsibilities:
- Inbound/outbound API integration
- Event emission into system bus
- Optional command exposure

### 2) Control Plugins (Ops)
Examples:
- `linux-server-control`
- `docker-control`
- `k8s-control`

Responsibilities:
- Controlled command/action execution
- Status polling and health checks
- Safety rails (allowlists, confirmation policies)

### 3) AI/Agent Plugins
Examples:
- `codex-control`
- `prompt-pack-enterprise`
- `review-automation`

Responsibilities:
- Add specialized prompts/rules/agents
- Register task-oriented tools/workflows
- Integrate with session/memory behaviors

### 4) Workflow Pack Plugins
Examples:
- `sales-workflows`
- `devops-workflows`

Responsibilities:
- Ship reusable JSON workflows
- Optional trigger templates

### 5) UI/UX Plugins
Examples:
- `dashboard-kpis`
- `theme-pack-neon`

Responsibilities:
- Panels, widgets, themes, docs snippets
- Declared renderer contributions (no implicit injection)

---

## Plugin Package Structure (Proposed)
`agentin/plugins/<plugin-id>/`

Suggested contents:
- `plugin.json` (required manifest)
- `README.md`
- `main.js` (optional backend entry)
- `connectors/*.js` (optional)
- `tools/*.js` (optional)
- `workflows/*.json` (optional)
- `ui/*` (optional declarative UI assets)
- `migrations/*` (optional version migrations)

---

## Manifest Contract (plugin.json)
Required fields:
- `id`
- `name`
- `version`
- `apiVersion`
- `description`

Important optional fields:
- `entrypoints`: backend/ui/lifecycle hooks
- `contributions`: tools/connectors/workflows/commands/themes/events
- `permissions`: declared requested capabilities
- `configSchema`: plugin-level settings
- `dependsOn`: plugin dependencies and version ranges
- `compatibility`: min app version, platform constraints

---

## Runtime Architecture
### New Core Component: PluginManager
PluginManager responsibilities:
1. Discover plugin manifests from `agentin/plugins/*/plugin.json`
2. Validate schema + compatibility + signatures (later phase)
3. Resolve dependency graph and load order
4. Register plugin contributions into existing subsystems
5. Track runtime state (`loaded`, `enabled`, `error`, `disabled`)
6. Expose control API to IPC/renderer

### Existing System Mapping
- MCPServer remains tool execution host.
- ConnectorRuntime remains worker-based integration host.
- WorkflowManager remains workflow file orchestrator.
- CapabilityManager remains permission authority.
- BackendEventBus remains event relay.

PluginManager becomes orchestration layer above them.

---

## Security Model
### Permission Levels
Each plugin declares requested permissions. Core grants/denies explicitly.

Example permission domains:
- `tools.register`
- `connector.run`
- `fs.read`, `fs.write`
- `network.outbound`
- `shell.exec`
- `docker.control`
- `server.control`
- `ui.panel.inject`
- `agent.prompt.modify`

### Isolation Strategy
- Tool plugins: run through MCP tool interfaces with capability checks.
- Connector plugins: run in worker threads (existing model).
- High-risk control plugins: explicit confirm mode + allowlisted actions.
- UI plugins: start declarative-first; avoid arbitrary renderer code initially.

### Safety Requirements for High-Risk Plugins
For Docker/server/Codex-control classes:
- Human confirmation for destructive actions.
- Audit logging for every privileged action.
- Dry-run mode where feasible.
- Configurable command allowlist.

---

## Lifecycle Model
Each plugin can implement lifecycle hooks:
1. `onInstall`
2. `onLoad`
3. `onEnable`
4. `onDisable`
5. `onUnload`
6. `onUpgrade`
7. `onRemove`

State is persisted so plugins recover correctly after restart.

---

## Configuration Model
- Global: plugin enabled/disabled state, version, health.
- Per-plugin settings: stored under namespaced keys (`plugin.<id>.*`).
- Secrets: never in source files; DB or secure OS keychain (future).
- Config schema drives UI forms and validation.

---

## Eventing Model
Plugins can:
- Subscribe to typed events (`chat:*`, `workflow:*`, `connector:*`, custom).
- Emit namespaced events (`plugin.<id>.<event>`).

All emitted events are logged and optionally forwarded to UI.

---

## Compatibility + Versioning
- `apiVersion` for plugin API contract evolution.
- Semver for plugin package version.
- Compatibility checks at load time:
  - App version range
  - Platform support (win/linux/mac)
  - Required core features present

---

## Rollout Plan (Phased)
### Phase 0: RFC + Spec
- Freeze manifest schema v1.
- Define permission catalog.
- Define stable plugin API surface.

### Phase 1: Foundation
- Implement PluginManager discovery/validation/load-state.
- Add plugin IPC endpoints (`list`, `enable`, `disable`, `inspect`).
- Add plugin table/state in DB.

### Phase 2: Contribution Registration
- Register tools via MCPServer through plugins.
- Register connectors via ConnectorRuntime through plugins.
- Import workflow packs from plugins.

### Phase 3: Security Hardening
- Enforce permission checks per contribution.
- Add audit logs and explicit confirmations for risky actions.
- Add plugin health checks and failure isolation.

### Phase 4: UI Extensions
- Declarative UI contributions (panels/routes/widgets).
- Plugin settings pages from `configSchema`.

### Phase 5: External Distribution
- Local install/update/uninstall flow.
- Optional registry + signature verification.

---

## Migration Strategy for Current Project
1. Wrap current connectors as first-class plugins.
2. Wrap custom tools as plugin contributions.
3. Wrap workflow bundles as plugin packs.
4. Keep old paths supported behind compatibility adapters.
5. Deprecate old direct-loading paths after stable migration window.

---

## Example Plugin Ideas for This Repo
1. `whatsapp-integration`
- Receives and sends WhatsApp messages, routes through dispatcher.

2. `linux-server-control`
- Restart services, view logs, health checks, restricted by allowlist.

3. `docker-control`
- List containers, restart/stop/start, read container logs.

4. `codex-control`
- Trigger code review flows, repo diagnostics, standard operation packs.

5. `devops-workflow-pack`
- Prebuilt workflows for incident response and routine maintenance.

---

## Non-Goals (for v1)
- Full arbitrary code execution in renderer UI.
- Cross-plugin unrestricted direct calls without API contracts.
- Public marketplace before permission + signing model is stable.

---

## Success Criteria
- New capability can be added as plugin without core edits.
- Plugin enable/disable takes effect without breaking other modules.
- High-risk plugins are safely gated and fully auditable.
- Existing connectors/tools/workflows migrate with minimal regressions.

---

## Immediate Next Steps
1. Approve this plan as architectural direction.
2. Define `plugin.json` schema v1 in a dedicated spec doc.
3. Implement minimal PluginManager with read-only discovery.
4. Migrate one real feature (recommended: Telegram/connector path) as pilot plugin.
