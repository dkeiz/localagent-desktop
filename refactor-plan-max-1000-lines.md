# Refactor Plan: Keep Files Under 1000 Lines (Default-First + Plugin Routes)

## Goal
1. Reduce oversized files to <=1000 lines without changing runtime behavior.
2. Make built-in backend handlers the explicit default path.
3. Let plugins act as optional alternative routes (extend/override/fallback) for both external and internal workflow use.
4. Prepare architecture for agent-created plugins with guardrails.

## Current Oversized Files (tracked)
- `src/renderer/styles/layout.css` (2750)
- `src/main/mcp-server.js` (2298)
- `src/renderer/components/main-panel.js` (1911)
- `src/main/ipc-handlers.js` (1704)
- `.vs/localagent/FileContentIndex/3c831041-b3bb-47d4-811d-6eb149adcfb0.vsidx` (1305)

## Constraints
- Preserve existing IPC channel names and payload shapes.
- Preserve MCP tool names and behavior.
- No "big bang" rewrite; split incrementally with parity checks after each step.
- Keep each newly created file <=700 lines to leave growth headroom.
- Keep default behavior intact when no plugins are enabled.

## Target Runtime Model (what you asked for)
### Default-First Routing
1. Every domain action has a canonical default handler in core code (`source=core`).
2. Plugin route is optional and explicit (`source=plugin`).
3. Router decides per action which route to execute:
   - `default`: always core
   - `extend`: core + plugin hooks
   - `override`: plugin replaces core if allowed
   - `fallback`: plugin used only when core fails

### Grouping (not class-heavy)
Use domain-grouped registration files and routing tables, not giant inheritance/class trees:
- `ipc/chat/*`, `ipc/tools/*`, `ipc/workflows/*`, `ipc/plugins/*`, `ipc/knowledge/*`
- `mcp/register-*.js` per tool domain
- `routes/*.js` per domain with plain objects/functions

### Plugin Scope Types
1. External integration plugins (APIs/connectors).
2. Internal workflow plugins (compose existing workflows/tools as plugin handlers).
3. Agent-created plugins (generated manifests + handlers, disabled by default until validated/approved by policy).

## Phase 1: `src/main/ipc-handlers.js`
1. Create folder `src/main/ipc/`.
2. Split handlers into domain modules:
   - `ipc/chat-handlers.js`
   - `ipc/tools-handlers.js`
   - `ipc/workflow-handlers.js`
   - `ipc/agent-handlers.js`
   - `ipc/plugins-handlers.js`
   - `ipc/knowledge-handlers.js`
3. Add `ipc/register-core-handlers.js` for default handlers only.
4. Add `ipc/register-plugin-handlers.js` for plugin-exposed channels.
5. Add `ipc/register-all-handlers.js` as orchestrator with explicit order:
   - register core
   - register plugin extension points
6. Keep `src/main/ipc-handlers.js` as thin adapter.
7. Verify all existing `ipcMain.handle(...)` channels still register once.

## Phase 2: `src/main/mcp-server.js`
1. Create folder `src/main/mcp/`.
2. Split into:
   - `mcp/core-server.js` (class skeleton, execute flow, validation)
   - `mcp/register-system-tools.js`
   - `mcp/register-web-tools.js`
   - `mcp/register-calendar-tools.js`
   - `mcp/register-file-tools.js`
   - `mcp/register-terminal-tools.js`
   - `mcp/register-media-tools.js`
3. Keep one exported `MCPServer` class; move only registration blocks first.
4. Add explicit helpers:
   - `registerCoreTool(name, def, handler)`
   - `registerPluginTool(name, def, handler, pluginMeta)`
   - `unregisterTool(name)`
5. Add route metadata to tool registry (`source`, `mode`, `domain`, `pluginId?`).
6. Verify tool list parity before/after split.

## Phase 3: Add Route Resolver Layer (core vs plugin)
1. Add `src/main/routes/route-resolver.js`.
2. Add per-domain route maps:
   - `routes/chat-routes.js`
   - `routes/workflow-routes.js`
   - `routes/tool-routes.js`
3. Resolve by policy:
   - default / extend / override / fallback
4. Persist route policy in DB settings:
   - `route.<domain>.<action>.mode`
   - `route.<domain>.<action>.pluginId`
5. Keep defaults set to `default` so behavior is unchanged unless explicitly switched.

## Phase 4: `src/renderer/components/main-panel.js`
1. Create folder `src/renderer/components/main-panel/`.
2. Extract:
   - `state.js` (panel state, derived flags)
   - `dom-bindings.js` (query/select/bind)
   - `message-renderer.js`
   - `request-controller.js` (send/cancel/retry)
   - `tool-call-renderer.js`
3. Keep current public init API intact to avoid touching other components.
4. Add minimal integration smoke checks for send message + render response.

## Phase 5: `src/renderer/styles/layout.css`
1. Create folder `src/renderer/styles/layout/`.
2. Split by area:
   - `layout-shell.css`
   - `layout-sidebar.css`
   - `layout-chat.css`
   - `layout-widgets.css`
   - `layout-responsive.css`
3. Import in `index.html` in stable order to avoid cascade regressions.
4. Keep tokens/variables in existing theme files; avoid variable duplication.

## Phase 6: Agent-Created Plugin Path
1. Define `plugin.json` schema version with required fields:
   - `id`, `name`, `version`, `main`, `capabilities`, `routeBindings`
2. Add plugin validation before load:
   - schema validate
   - route binding validate (only allowed domains/actions)
3. Add `agent plugin draft` flow:
   - agent can generate plugin files in `agentin/plugins-drafts/`
   - drafts are disabled and non-executable until approved/promoted
4. Add promotion step:
   - move draft to `agentin/plugins/<id>/`
   - register as disabled plugin
   - explicit enable required
5. Add audit metadata:
   - `created_by` (`user`/`agent`)
   - `created_from_session`
   - `approved_by`

## Phase 7: Repository Hygiene
1. Stop tracking `.vs/**` in Git (`.gitignore` update + remove tracked entries).
2. Keep generated/editor index files out of line-count policy.
3. Add a line-count check script (non-blocking CI warning first, then enforce).

## Suggested Verification Per Phase
1. Run `npm run test:headless`.
2. Start app and manually verify:
   - Chat send/receive
   - Tool execution
   - Plugin list/enable/disable
   - Knowledge tree listing
   - Route mode behavior (`default`, `extend`, `override`, `fallback`)
   - Core behavior unchanged when all plugins disabled
3. Confirm no IPC channel missing (console check at boot).
4. Confirm no MCP tool missing (compare tool names snapshot).
5. Confirm plugin unload removes only plugin-owned routes/tools.
6. Confirm failed plugin enable rolls back partial registrations.

## Rollout Strategy
1. One phase per PR/commit.
2. No behavior changes mixed with file-splitting commits.
3. Freeze feature work in target file during its split to avoid merge churn.
4. Land Phase 1 + 2 first (grouping + extraction), then Phase 3 route resolver.
5. Keep plugin routing feature-flagged until parity tests are green.

## Current Status
1. Phase 1 (`ipc-handlers`) is implemented:
   - `src/main/ipc-handlers.js` is now a thin adapter.
   - grouped registrars were added under `src/main/ipc/`.
2. Added test scripts:
   - `tools/test-ipc-registration.js`
   - `tools/test-plugin-knowledge-managers.js`
3. Added npm scripts:
   - `test:ipc-handlers`
   - `test:plugin-knowledge`
   - `test:core`
