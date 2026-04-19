# LocalAgent — Development History & Plan Audit

This file consolidates all previous plan files into a single historical record.
Each section preserves the original plan's intent and adds an implementation audit: what was built, what's partial, and what was skipped.

**Frozen date:** 2026-04-19
**Source plans merged:** `futureplugin.md`, `knowledge.md`, `multitool developing.plan`, `current_suggestions.md`, `subagent-architecture.md`, `refactor-plan-max-1000-lines.md`
**Living documents NOT merged (still active):** `guardrails_for_developing.md`, `supermultiagentresearch`, `MCP_TOOLS_GUIDE.md`, `QUICK_START.md`

---

## 1. Plugin System (`futureplugin.md`)

### Original Intent
Build a unified plugin architecture where capabilities (integrations, ops control, AI agents, workflow packs, UI extensions) can be added/removed without touching core code. Five plugin types proposed: Integration, Control (Ops), AI/Agent, Workflow Pack, UI/UX.

### Implementation Status

| Area | Status | Notes |
|------|--------|-------|
| Plugin package structure (`agentin/plugins/<id>/`) | ✅ Done | `plugin.json` + `main.js` contract is live |
| PluginManager discovery & validation | ✅ Done | `src/main/plugin-manager.js` — 457 lines, scans, validates manifests |
| Plugin enable/disable lifecycle | ✅ Done | `onEnable(context)` / `onDisable()` hooks, hot-reload via require cache clear |
| Plugin tool registration via `context.registerHandler()` | ✅ Done | Registers through `MCPServer.registerTool()` |
| Capability gating for plugin tools | ✅ Done | `CapabilityManager.registerCustomTool()` on enable |
| Plugin rollback on enable failure | ✅ Done | `_cleanupPluginHandlers()` removes partial registrations |
| Plugin config (DB-backed, namespaced) | ✅ Done | `plugin.<id>.*` settings pattern |
| Auto-generate knowledge on plugin enable | ✅ Done | `_generatePluginKnowledge()` creates knowledge item |
| Plugin IPC endpoints (list, enable, disable, inspect) | ✅ Done | `register-plugin-knowledge-handlers.js` |
| Plugin UI — panel widget + studio overlay | ✅ Done | `plugin-panel.js` + `plugin-studio-panel.js` |
| Plugin quick setup service | ✅ Done | `plugin-setup-service.js` for SearXNG |
| Orphaned plugin tool cleanup | ✅ Done | `_cleanupOrphanedPluginTools()` |
| Plugin contract validation | ✅ Done | `_validatePluginToolContracts()` |
| **Real plugins shipped** | ✅ Partial | `searxng-search` (full), `test-plugin` (test fixture) |
| Manifest schema v1 formal spec | ❌ Skipped | No dedicated schema doc; working contract is `plugin.json` fields |
| Permission catalog per plugin | ❌ Skipped | No per-capability permission model — plugins get full tool registration |
| Plugin dependency graph | ❌ Skipped | No `dependsOn` resolution |
| Plugin signature/verification | ❌ Skipped | Phase 5 — not started |
| Isolation: worker threads for plugins | ❌ Skipped | Plugins run in-process via `require()` |
| UI extension contributions (declarative panels) | ❌ Skipped | Phase 4 — not started |
| External distribution/registry | ❌ Skipped | Phase 5 — not started |
| Migration of existing connectors → plugins | ❌ Skipped | Connectors remain separate runtime |
| Agent-created plugin drafts path | ❌ Skipped | `agentin/plugins-drafts/` not implemented |

### Observation
Plugin system is **functionally complete for Phase 1-2** of the original plan. Core lifecycle, tool registration, config, knowledge generation, and UI management all work. The security hardening (Phase 3), UI extensions (Phase 4), and distribution (Phase 5) remain future work. The biggest gap is that plugins run unsandboxed in-process — no worker thread isolation exists.

---

## 2. Knowledge Layer (`knowledge.md`)

### Original Intent
File-first knowledge subsystem with `library/` (active), `staging/` (candidates), `research/` (persistent multi-step), and `artifacts/` (promoted). Dynamic retrieval via tools, not preloaded. Background daemon does knowledge-shift.

### Implementation Status

| Area | Status | Notes |
|------|--------|-------|
| `KnowledgeManager` class | ✅ Done | `src/main/knowledge-manager.js` — 356 lines |
| `agentin/knowledge/library/` and `staging/` | ✅ Done | Directories created, items stored as folders |
| `meta.json` per knowledge item | ✅ Done | slug, title, category, tags, source, confidence, timestamps |
| Auto-split content at 200-line limit | ✅ Done | `_writeContent()` splits into `content-01.md`, etc. |
| DB index for knowledge items | ✅ Done | `knowledge_items` table synced from disk |
| `explore_knowledge` MCP tool | ✅ Done | Returns knowledge tree for LLM discovery |
| Knowledge item CRUD (create, update, promote, reject) | ✅ Done | Full API with safety checks |
| Staged vs active safety | ✅ Done | `rejectStaged()` refuses to delete non-staged items |
| Observation intake for daemon | ✅ Done | `ingestObservation()` method |
| Rebuild index from disk | ✅ Done | `_rebuildIndex()` on startup |
| `agentin/knowledge/research/` folder | ❌ Skipped | Research runs live under `agentin/research/runs/` separately |
| `agentin/knowledge/artifacts/` promoted workspace outputs | ❌ Skipped | No `promote_workspace_artifact` tool |
| MCP tools: `list_knowledge`, `search_knowledge`, `read_knowledge` | ⚠️ Partial | `explore_knowledge` exists; no semantic search or dedicated read tool |
| `create_knowledge_note`, `start_research_run`, etc. tools | ⚠️ Partial | Research runtime has own tools, not wired into knowledge tools |
| Background knowledge-shift in memory daemon | ❌ Skipped | Daemon does memory consolidation but not knowledge curation |
| Scope model (`global`, `agent:<slug>`, `task:<id>`) | ❌ Skipped | No scope field in metadata |
| Knowledge guidance in inference dispatcher | ❌ Skipped | No `knowledge_guidance` prompt section |
| Embedding-based semantic search | ❌ Skipped | `embedding-service.js` and `vector-store.js` exist but not wired to knowledge |

### Observation
Knowledge system has **solid file-first foundations** — the folder structure, DB index, lifecycle states, and safety all work. The gaps are in retrieval sophistication (no semantic search, no scope filtering), research integration (research runtime is a separate system), and the daemon knowledge-shift pass. The knowledge layer works as manual/LLM-driven storage but not yet as an intelligent, self-curating knowledge base.

---

## 3. Multi-Tool Development (`multitool developing.plan`)

### Original Intent
Four-phase system: tool groups & activation → tool chaining with auto-continuation → workflow learning & storage → workflow retrieval via vector embeddings.

### Implementation Status

| Area | Status | Notes |
|------|--------|-------|
| **Phase 1: Tool Groups** | ✅ Done | `tool-groups.json` defines groups; `CapabilityManager` manages activation |
| Tool registry with descriptions | ✅ Done | `MCPServer` holds all tools with definitions |
| Group activate/deactivate | ✅ Done | UI toggles in capability panel, file mode cycle |
| Context builder (active tools only) | ✅ Done | `inference-dispatcher.js` injects only active tool docs |
| **Phase 2: Tool Chaining** | ✅ Done | `ToolChainController` — 449 lines |
| Auto-continuation loop | ✅ Done | Loops until `end_answer`, no tools, or max steps |
| Tool call deduplication | ✅ Done | `_shouldSkipDuplicate()` |
| Tool call ID tracking | ✅ Done | Unique IDs with timestamps per call |
| `end_answer` completion tool | ✅ Done | Chain terminates on `end_answer` call |
| Max chain steps limit | ✅ Done | Default 10, configurable |
| **Phase 3: Workflow Learning** | ✅ Done | `WorkflowManager` — 16887 bytes |
| Auto-capture tool chains as workflows | ✅ Done | `autoCapture` toggle in ToolChainController |
| Workflow CRUD | ✅ Done | DB + file-first JSON storage |
| Workflow run tracking | ✅ Done | `WorkflowRuntime` — run folders with trace, status, result |
| Trigger patterns | ✅ Done | `trigger_pattern` field in workflows |
| **Phase 4: Vector Retrieval** | ⚠️ Partial | `vector-store.js` + `embedding-service.js` exist |
| Embedding-based workflow match | ❌ Skipped | Code files exist but not wired into workflow retrieval flow |
| Workflow success/failure tracking | ⚠️ Partial | Run records track status but no aggregate scoring |

### Observation
Phases 1-3 are **fully implemented and working**. The tool group system, chaining with auto-continuation, and workflow learning/storage are all production-ready. Phase 4 (vector retrieval) has skeleton code but is not actually wired — workflow matching currently relies on trigger patterns, not embeddings.

---

## 4. Current Suggestions (`current_suggestions.md`)

### Original Intent
Bug fixes and hardening pass — 22 items fixed, 7 items still needing attention.

### Implementation Status

| Fixed Item | Status |
|------------|--------|
| Plugin handlers register with CapabilityManager | ✅ Verified in code |
| Plugin enable failure rollback | ✅ Verified |
| Knowledge rejectStaged safety | ✅ Verified |
| Duplicate tool registration protection | ✅ Verified |
| explore_knowledge registered with CapabilityManager | ✅ Verified |
| Calendar/todo IPC bridge restored | ✅ Present in electron-api.js |
| Calendar/todo containers in HTML | ✅ Present in index.html |
| Calendar/todo widget wiring repaired | ✅ calendar.js / todos.js exist |
| Plugin panel HTML injection fixed | ✅ plugin-panel.js |
| Sidebar safe rendering | ✅ sidebar.js |
| Message formatter markdown handling | ✅ message-formatter.js |
| Test suite + contract tests | ✅ 35 contract test files |
| MCP tool split into domain registrars | ✅ `src/main/mcp/register-*.js` — 10 files |
| Main panel split + permission dialog | ✅ main-panel-tabs.js + main-panel-permissions.js |
| Layout CSS split | ✅ `src/renderer/styles/layout/` exists |
| Subagent async runtime rework | ✅ subtask-runtime.js |
| Chat rendering + scroll fix | ✅ message-formatter.js + main-panel.js |
| Subagent contract test | ✅ Multiple subagent contract tests |

| Still Not Clean | Status |
|-----------------|--------|
| `nodeIntegration: true` in Electron | ❌ Still insecure |
| Workflow popup nodeIntegration | ❌ Still insecure |
| Raw `messagesHTML` tab persistence | ❌ Still coupled to markup |
| Rule manager innerHTML injection | ❌ Still unsafe |
| Sidebar remaining innerHTML sections | ❌ Still partially unsafe |
| Ad hoc dynamic tool registration | ⚠️ Improved but no unified registry API |
| Deeper test coverage for risky surfaces | ⚠️ Better but gaps remain |

### Observation
The 22 fixes are **all verified in the codebase**. The 7 "still not clean" items remain unchanged — most are security/architecture debt that should be addressed but aren't blocking functionality.

---

## 5. Subagent Architecture (`subagent-architecture.md`)

### Original Intent
Two invocation modes: delegated subtask (hidden worker) and direct user chat. File-backed run folders, event bus notifications, durable result delivery.

### Implementation Status

| Area | Status | Notes |
|------|--------|-------|
| SubtaskRuntime class | ✅ Done | 514 lines, full run lifecycle |
| Run folder structure (request, status, result, messages, trace, artifacts) | ✅ Done | All files created |
| Delegated run → auto-deliver to parent | ✅ Done | `deliverToParent()` with inbox system |
| Direct user chat mode | ✅ Done | Agent picker in UI, sub agents can be opened as chats |
| Event bus integration (queued/started/completed/failed) | ✅ Done | Events in BackendEventBus catalog |
| Stale run cleanup | ✅ Done | 24-hour cleanup on init |
| Subagent contract module | ✅ Done | `subagent-contract.js` |
| MCP tools for delegation | ✅ Done | `register-agent-tools.js` — delegate_to_subagent, get_subagent_run |
| Multiple contract tests | ✅ Done | 5 subagent test files |
| Pro agents (5 defined) | ✅ Done | background-daemon, code-reviewer, file-manager, system-monitor, web-researcher |
| Sub agents (11 defined) | ✅ Done | Various live/test/specialized agents |

### Observation
Subagent architecture is **fully implemented** as designed. Both invocation modes work, file-backed state is solid, delivery to parent works. This is one of the most complete subsystems in the project.

---

## 6. Refactor Plan — Max 1000 Lines (`refactor-plan-max-1000-lines.md`)

### Original Intent
Split oversized files, establish default-first routing with plugin override/extend/fallback, agent-created plugin path.

### Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: IPC handlers split | ✅ Done | `src/main/ipc/` with 8 domain files |
| Phase 2: MCP server split | ✅ Done | `src/main/mcp/` with 10 registrar files |
| Phase 3: Route resolver layer | ❌ Skipped | No `src/main/routes/` — core-vs-plugin routing not formalized |
| Phase 4: Main panel split | ✅ Partial | Tabs and permissions extracted; main-panel.js still 43KB |
| Phase 5: Layout CSS split | ✅ Done | `src/renderer/styles/layout/` directory |
| Phase 6: Agent-created plugin path | ❌ Skipped | No `plugins-drafts/` or validation/promotion flow |
| Phase 7: Repository hygiene | ⚠️ Partial | `.gitignore` exists but no line-count CI enforcement |
| Line budget contract test | ✅ Done | `line-budget-contract.test.js` |

### Observation
The file-splitting refactor (Phases 1, 2, 5) was **executed well**. The route resolver and agent-created plugin paths remain future work. `main-panel.js` at 43KB suggests it could use further splitting but is under the line budget due to long lines.

---

## Summary: What's Built vs What's Missing

### Fully Implemented ✅
- Plugin system (lifecycle, tools, config, knowledge, UI)
- Tool groups + activation + context builder
- Tool chaining with auto-continuation
- Workflow learning + capture + storage + runs
- Subagent architecture (delegated + direct chat)
- Knowledge manager (file-first, DB-indexed, lifecycle)
- Event bus (typed events, inference dispatch, UI relay)
- Connector runtime (worker threads, config, lifecycle)
- Research runtime (baseline vs variants, scoring, reports)
- Session workspaces (per-session temp folders)
- Skin system (8 skins, manifest, contract)
- Multiple LLM providers (5 adapters: Ollama, LMStudio, OpenRouter, OpenAI-compatible, Qwen)
- Contract test infrastructure (35 tests)
- Background daemons (memory daemon, workflow scheduler)

### Partially Implemented ⚠️
- Knowledge retrieval (tree browse works, no semantic search)
- Vector store / embeddings (code exists, not wired)
- Main panel modularization (started but still large)
- Tool registration unified API (improved but ad hoc)
- Workflow success tracking (runs tracked, no aggregate)

### Not Started ❌
- Plugin sandboxing / isolation (worker threads)
- Plugin permission model (per-capability)
- Plugin dependency resolution
- Plugin signature + distribution
- Agent-created plugins with validation
- Route resolver (core vs plugin routing)
- Knowledge semantic search via embeddings
- Knowledge daemon curation pass
- Knowledge scope model
- Electron security hardening (contextIsolation)
- Rule manager XSS cleanup
- Remaining sidebar HTML injection cleanup

---

*This file is a historical record. Future development follows `supermultiagentresearch` as the vision document and the partitioned implementation plans (Part 1, Part 2, ...) as the working roadmaps.*
