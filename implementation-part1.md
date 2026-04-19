# Part 1 — SuperAgent Foundation: Agent Workspaces, File-Diff Tool, Parallel Orchestration, and Agent Chat UI

## Design Principles (from user direction)

1. **SuperAgents are regular agents.** Same runtime, same code path. Differentiated only by: specialized system prompts, tool permission profiles, and per-agent UI elements.
2. **No tool duplication.** "Research plan" is just `write_file` into the agent-owned folder. "Read research plan" is just `read_file`. No `create_research_plan` or `get_research_results` MCP tools.
3. **What we actually need is a good file edit/diff tool.** Agents need to edit existing files surgically, not just overwrite. That's the missing MCP capability.
4. **Universal paths, not absolute.** Agents get path tokens like `{agent_home}`, `{workspace}`, `{agentin}` that resolve at runtime. Prompts use these tokens; the dispatcher resolves them before inference.
5. **Agent private subfolders.** Each agent already has `agentin/agents/{type}/{slug}/`. Expand this: agents can read/write freely inside their own folder tree. SuperAgents get additional subdirs like `tasks/`, `plans/`, `outputs/`.
6. **Provider-aware parallel execution.** Same-provider subagents queue or run sequentially (to avoid inference lock contention). Different-provider subagents run truly in parallel (different LLM backends = no contention).
7. **Agent UI via agent-bound plugins.** Each agent can have a companion plugin (in `agentin/plugins/agent-<slug>/`) that auto-enables when the agent is activated and auto-disables when deactivated. The plugin can inject UI into the chat tab (file explorer, charts, etc.) via the existing plugin system. Different agents get different UIs through their own plugins.
8. **Existing 4 agents (pro type) get this treatment.** They're already "super agents" — they just need companion plugins for UI and awareness of their agent-owned folders.

---

## What Already Exists

| Component | File | Relevant |
|-----------|------|----------|
| Agent CRUD + lifecycle | `agent-manager.js` | ✅ agents have folders at `agentin/agents/{type}/{slug}/` |
| Agent folder structure | `_ensureAgentFolder()` | ✅ creates `memory/`, `config/`, or `temp/` subfolders |
| System prompt from file | `getAgentSystemPrompt()` | ✅ reads `system.md` from agent folder |
| Agent memory (compact) | `getAgentMemory()` | ✅ reads `memory/compact.md` |
| Subagent delegation | `invokeSubAgent()` | ✅ creates run, fires events, executes delegated run |
| Delegated execution | `_executeDelegatedRun()` | ✅ chains tools, collects result, delivers to parent |
| Inference lock | `InferenceDispatcher._lock` | ✅ serializes same-provider calls, `skipLock` for subagents |
| File tools | `register-file-tools.js` | ✅ read_file, write_file, list_directory, file_exists, delete_file |
| No `edit_file` tool | — | ❌ missing — agents can only overwrite entire files |
| Session workspace | `session-workspace.js` | ✅ per-session temp folders |
| Agent picker UI | `agent-picker.js` | ✅ lists pro/sub agents, click to open chat tab |
| Chat tab manager | `main-panel-tabs.js` | ✅ tab open/close/switch with agent identity |
| Runtime paths | `runtime-paths.js` | ✅ centralized path resolution |
| Environment prompt | `inference-dispatcher.js` L199-237 | ✅ injects absolute paths into system prompt |

---

## Proposed Changes

### 1. Agent Private Workspace — Expanded Folder Structure

**Owner:** `agent-manager.js`

Currently `_ensureAgentFolder()` creates `memory/` and `config/` (pro) or `temp/` (sub). Expand it to always create:

```
agentin/agents/{type}/{slug}/
├── system.md          # (existing) agent system prompt
├── memory/            # (existing) compact memory
├── config/            # (existing) agent config
├── tasks/             # NEW — agent's task files, plans, notes
├── outputs/           # NEW — agent's produced artifacts, reports
```

**Change:** `_ensureAgentFolder()` adds `tasks/` and `outputs/` to the subdirectory list for all agent types.

**Size:** ~8 lines changed in `agent-manager.js`

---

### 2. Universal Path Tokens in Agent System Prompts

**Owner:** `inference-dispatcher.js`

Currently the environment block injects absolute paths like `C:\Users\...\agentin\memory`. This breaks portability and makes prompts tied to the machine.

Add a **path token resolution** step in `_buildSystemPrompt()`:

| Token | Resolves to |
|-------|-------------|
| `{agentin}` | `agentin/` root (absolute) |
| `{agent_home}` | `agentin/agents/{type}/{slug}/` for the current agent |
| `{agent_tasks}` | `{agent_home}/tasks/` |
| `{agent_outputs}` | `{agent_home}/outputs/` |
| `{workspace}` | `agentin/workspaces/{sessionId}/` |
| `{knowledge}` | `agentin/knowledge/` |
| `{memory}` | `agentin/memory/` |

**How it works:**
- When `agentId` is present in dispatch options, resolve the agent's folder path from `agentManager`
- Build a `pathTokens` map
- Inject a `<path_tokens>` block into the system prompt so the agent can reference them
- No search-and-replace in the agent's system.md — the tokens are guidance, the agent uses them in tool calls like `TOOL:write_file{"path":"{agent_tasks}/research-plan.md","content":"..."}`
- BUT: the token resolution happens in the file tools themselves, not the prompt. The dispatcher just **declares** the tokens. The file tool handlers resolve `{agent_home}` etc. before executing.

**Change in `inference-dispatcher.js`:**
- In `_buildSystemPrompt()`, when `agentId` is present, add a `<agent_paths>` section with the resolved tokens
- ~30 lines added

**Change in `register-file-tools.js`:**
- Add a `resolvePathTokens(rawPath, context)` function that replaces `{agentin}`, `{agent_home}`, etc. with actual absolute paths
- The `context` comes from `mcpServer` which holds the current agent/session info
- Each file tool (`read_file`, `write_file`, `list_directory`, `file_exists`, `delete_file`) calls `resolvePathTokens()` on the `path` param before executing
- ~40 lines added (helper + integration)

**Change in `mcp-server.js`:**
- Add `setCurrentAgentContext({ agentId, agentFolderPath, sessionId })` method
- Called by `agent-manager.js` before delegated dispatch
- ~10 lines added

---

### 3. `edit_file` MCP Tool — Surgical File Editing

**Owner:** `register-file-tools.js`

The critical missing capability. Currently agents can only `write_file` (full overwrite) or `read_file`. For research plans, code, notes — agents need to edit sections of existing files.

**New tool: `edit_file`**

```
TOOL:edit_file{
  "path": "{agent_tasks}/plan.md",
  "edits": [
    {
      "search": "## Status: pending",
      "replace": "## Status: in-progress"
    },
    {
      "search": "- [ ] Step 3: analyze results",
      "replace": "- [x] Step 3: analyze results\n\nResults: Found 5 models with >90% accuracy"
    }
  ]
}
```

**Parameters:**
- `path` (string, required) — file path (supports path tokens)
- `edits` (array, required) — array of `{ search, replace }` objects
- Each `search` must be an exact substring match in the current file content
- Each `replace` is the replacement text
- Edits are applied sequentially (first match wins per search string)
- Returns: `{ path, editsApplied, editsSkipped, newSize }`

**Error handling:**
- If file doesn't exist → error
- If `search` string not found → skip that edit, report in `editsSkipped`
- If multiple matches of same `search` → replace first occurrence only (safe default)

**Size:** ~60 lines in `register-file-tools.js`

---

### 4. Provider-Aware Parallel Orchestration

**Owner:** `agent-manager.js` (new method `invokeMultipleSubAgents`)

The existing `invokeSubAgent()` fires one subagent at a time. Add a `invokeMultipleSubAgents()` method that accepts an array of subagent tasks and runs them with provider-aware concurrency:

**Logic:**
1. Accept array of `{ subAgentId, task, options }` entries
2. For each entry, resolve the agent's configured provider (from agent config or default)
3. Group tasks by provider
4. **Same provider:** run sequentially (inference lock prevents true parallel on same backend anyway)
5. **Different providers:** run in parallel via `Promise.allSettled()`
6. Return consolidated results array

**Why not a separate class:** This is just a method on `AgentManager` that composes existing `invokeSubAgent()` calls. No new service, no new bus events — just smarter batching.

**MCP tool exposure:** Register through existing `register-agent-tools.js` as an additional action on the existing `subagent` tool:

```
TOOL:subagent{"action":"run_batch","tasks":[
  {"subagent_id":3,"task":"Research topic A"},
  {"subagent_id":5,"task":"Research topic B"}
]}
```

**Size:** ~80 lines added to `agent-manager.js`, ~20 lines added to `register-agent-tools.js`

---

### 5. Agent-Bound Plugin System — UI Per Agent

**Owner:** `agent-manager.js` + `plugin-manager.js`

Each pro agent can have a companion plugin at `agentin/plugins/agent-<slug>/`. The plugin manifest includes an `agentId` or `agentSlug` field that ties it to its agent. When the agent is activated, its companion plugin auto-enables. When deactivated, auto-disables.

**plugin.json for agent-bound plugins has a new field:**
```json
{
  "id": "agent-web-researcher",
  "name": "Web Researcher UI",
  "agentSlug": "web-researcher",
  "main": "main.js",
  "version": "1.0.0",
  "description": "File browser and workspace UI for Web Researcher agent"
}
```

**Plugin context gets new UI hooks:**
```js
onEnable(context) {
  // Register a chat tab UI contribution
  context.registerChatUI({
    // Returns HTML string to inject above messages area for this agent
    renderPanel: (agentInfo) => `<div class="agent-files-panel">...</div>`,
    // Called when tab becomes active
    onTabActivated: (agentInfo) => { /* refresh file list */ },
    // Called when tab loses focus
    onTabDeactivated: () => { /* cleanup */ }
  });
}
```

**Auto-activation flow:**
1. `agentManager.activateAgent(id)` → resolves agent slug
2. Checks `pluginManager` for a plugin with matching `agentSlug`
3. If found and not already enabled → `pluginManager.enablePlugin(pluginId)`
4. On `deactivateAgent(id)` → if the companion plugin is agent-bound → `pluginManager.disablePlugin(pluginId)`

**Renderer side:**
- `main-panel-tabs.js` checks for registered `chatUI` contributions when rendering agent tabs
- The plugin's `renderPanel()` output is injected above the messages container
- `onTabActivated()` / `onTabDeactivated()` lifecycle hooks fire on tab switch
- This is communicated via IPC: `get-agent-chat-ui` handler returns the HTML/config

**IPC additions:**
- `list-agent-files` → returns file tree for an agent (used by agent plugins)
- `read-agent-file` → returns file content by relative path within agent folder
- `get-agent-chat-ui` → returns chat UI config/HTML for the active agent's plugin

**Files:**
- MODIFY: `src/main/agent-manager.js` — auto-enable/disable companion plugins (~25 lines)
- MODIFY: `src/main/plugin-manager.js` — `getAgentPlugin(slug)` lookup, `registerChatUI` context method (~30 lines)
- MODIFY: `src/main/ipc/register-agent-system-handlers.js` — 3 new handlers (~40 lines)
- MODIFY: `src/renderer/components/main-panel-tabs.js` — chat UI injection on tab switch (~20 lines)
- NEW: `agentin/plugins/agent-file-browser/` — shared file browser plugin usable by any agent (~120 lines)
- MODIFY: `src/renderer/styles/layout/main-panel.css` — agent panel styles (~40 lines)

---

### 6. Research SuperAgent — Prompt Definition (No New Code, Just Agent Config)

This is NOT a new class or service. It's a new **agent definition** — a pro agent with a specialized system prompt that describes research orchestration behavior.

**New agent:** `Research Orchestrator` (pro type)

**Folder:** `agentin/agents/pro/research-orchestrator/`

**system.md contents (the "superagent" prompt):**

```markdown
You are a **Research Orchestrator Agent**. You plan, coordinate, and synthesize 
multi-source research by delegating tasks to sub-agents and managing your findings 
as structured files.

## Your Workspace
- Your agent-owned folder: {agent_home}
- Task plans: {agent_tasks}
- Final outputs: {agent_outputs}

## How You Work

### 1. Plan Phase
When given a research goal:
- Create a research plan file at `{agent_tasks}/plan-<topic-slug>.md`
- The plan should list: goal, approach, sub-tasks to delegate, expected outputs
- Use write_file to create the plan

### 2. Execute Phase  
- Delegate sub-tasks to available sub-agents using the subagent tool
- Use run_batch to parallelize when sub-agents use different providers
- Monitor runs using subagent action="status"
- Collect results and save intermediate findings to `{agent_tasks}/`

### 3. Synthesize Phase
- Read all collected findings
- Create a final report at `{agent_outputs}/report-<topic-slug>.md`
- Include: summary, key findings, sources, recommendations, data tables
- Update the plan file status using edit_file

### 4. Iterate
- If the user asks to refine or explore deeper, update the plan and re-delegate

## Rules
- Always save your work as files — never keep important findings only in chat
- Use edit_file to update existing plans and reports, not full overwrites
- Structure outputs with markdown headers, tables, and bullet points
- When delegating, be specific about what each sub-agent should return
```

**This agent gets seeded** alongside existing defaults in `_seedDefaultAgents()` — just one more entry in the array.

**Size:** ~20 lines added to `agent-manager.js` `_seedDefaultAgents()`

---

## Files Changed/Created Summary

| Action | File | Lines Changed |
|--------|------|---------------|
| MODIFY | `src/main/agent-manager.js` | +130 (folder expansion, batch invoke, seed new agent, plugin auto-enable) |
| MODIFY | `src/main/inference-dispatcher.js` | +35 (agent path tokens in prompt) |
| MODIFY | `src/main/mcp-server.js` | +15 (agent context setter) |
| MODIFY | `src/main/mcp/register-file-tools.js` | +100 (edit_file tool + path token resolution) |
| MODIFY | `src/main/mcp/register-agent-tools.js` | +25 (run_batch action) |
| MODIFY | `src/main/plugin-manager.js` | +30 (agentSlug lookup, chatUI context) |
| MODIFY | `src/main/ipc/register-agent-system-handlers.js` | +40 (agent file list/read/chatUI) |
| MODIFY | `src/renderer/components/main-panel-tabs.js` | +20 (chat UI injection) |
| MODIFY | `src/renderer/styles/layout/main-panel.css` | +40 (agent panel styles) |
| NEW | `agentin/plugins/agent-file-browser/plugin.json` | ~15 |
| NEW | `agentin/plugins/agent-file-browser/main.js` | ~120 |
| NEW | `tests/contracts/edit-file-tool-contract.test.js` | ~80 |
| NEW | `tests/contracts/path-token-contract.test.js` | ~60 |
| **Total** | | **~710 lines** |

---

## Verification Plan

### Contract Tests
1. `edit_file` tool: apply single edit, multiple edits, missing search string, file not found
2. Path token resolution: `{agent_home}` resolves correctly, unknown tokens passed through safely
3. `invokeMultipleSubAgents`: groups by provider, same-provider sequential, different-provider parallel

### Manual Tests
1. Create the Research Orchestrator agent → verify folder structure created with `tasks/` and `outputs/`
2. Open Research Orchestrator chat → verify file browser panel appears (empty state)
3. Ask it to "create a research plan about best local LLM models for coding" → verify it writes a plan file
4. File browser updates → verify plan file appears and is clickable
5. Ask it to "delegate research to sub-agents" → verify subagent runs execute
6. Ask it to "synthesize findings" → verify report appears in `outputs/`
7. Use `edit_file` from any agent → verify search-replace works on existing files

### Run existing test suites
```
npm run test:contracts
npm run test:core
```

---

## What This Does NOT Include (Saved for Later Parts)

- Per-agent provider override (Part 3)
- Agent-specific tool permission profiles — currently all agents share the same capability set. A `tool_permissions` field in agent config is Part 2
- Interactive chart/data rendering in chat (Part 2)
- Headless/CLI research mode (Part 3)
- Vector-based retrieval of past research (Part 8)
