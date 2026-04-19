# Part 1 — Implementation Tasks

- [x] 1. Agent folder expansion (tasks/, outputs/)
- [x] 2. `edit_file` MCP tool
- [x] 3. Universal path tokens (inference-dispatcher + file tools + mcp-server context)
- [x] 4. Agent-bound plugin system
  - [x] 4a. `pluginManager.getAgentPlugin(slug)` lookup
  - [x] 4b. `registerChatUI` in plugin context
  - [x] 4c. Auto-enable/disable in `agentManager.activateAgent/deactivateAgent`
  - [x] 4d. IPC handlers: list-agent-files, read-agent-file, get-agent-chat-ui
  - [x] 4e. Renderer: chat UI injection in main-panel-tabs.js
- [x] 5. Agent file browser plugin (`agentin/plugins/agent-file-browser/`)
- [x] 6. Provider-aware batch invoke (`invokeMultipleSubAgents`)
- [x] 7. Research Orchestrator agent seed
- [x] 8. Agent panel CSS styles
- [x] 9. Contract tests
- [x] 10. Run test suites (targeted feature contracts + line budget only; no broad/blocking suite)
