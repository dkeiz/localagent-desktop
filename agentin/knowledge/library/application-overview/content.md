# LocalAgent — Application Overview

## Architecture
- Electron desktop app (Node.js backend + HTML/CSS/JS frontend)
- SQLite database (better-sqlite3) for persistence
- Multi-provider LLM support (Ollama, OpenAI, Anthropic, Google, etc.)
- MCP (Model Context Protocol) tool system
- Background daemon for autonomous behaviors

## Core Systems
- **InferenceDispatcher**: Central LLM routing with mode-based prompt building
- **MCPServer**: Tool registration, execution, and capability gating
- **AgentLoop**: Autonomous agent behaviors with session management
- **BackgroundMemoryDaemon**: Scheduled memory housekeeping and observation
- **ConnectorRuntime**: External service connectors in worker threads
- **WorkflowManager**: Learned tool chain workflows
- **AgentManager**: Multi-agent system with specialized agents

## Plugin System
Plugins live in agentin/plugins/<id>/. Each plugin has:
- plugin.json — manifest (id, name, version, main, configSchema)
- main.js — entry point: exports { onEnable(context), onDisable() }
Plugins register handlers via context.registerHandler() which creates MCP tools.
Plugin config stored in settings table as plugin.<id>.<key>.

## Knowledge System
Knowledge lives in agentin/knowledge/. Two tiers:
- library/ — confirmed, active knowledge
- staging/ — daemon-generated candidates
Each item is a folder with meta.json + content files (max 200 lines each).
LLM discovers knowledge via explore_knowledge tool, reads with read_file.

## Key Directories
- agentin/ — agent configuration root
- agentin/memory/ — persistent memory files
- agentin/plugins/ — installed plugins
- agentin/knowledge/ — personal knowledge store
- agentin/workspaces/ — per-session temp folders
