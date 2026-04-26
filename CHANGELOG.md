# Changelog

All notable changes to LocalAgent Desktop will be documented in this file.

## [0.1.0-alpha] — 2026-04-26

### 🎉 Initial Alpha Release

First public alpha release for community testing.

### Core Features
- Multi-chat sessions with persistent history and tab restore
- Async (non-blocking) chat — send messages while AI is thinking
- 37 built-in MCP tools across 8 domains (system, agent, web, files, terminal, calendar, media, connectors)
- Tool chain controller with auto-continuation and deduplication
- Tool permission system with capability groups and user approval flow

### LLM Provider Support
- 8 provider adapters: Ollama, LM Studio, OpenRouter, OpenAI-compatible, Qwen, Codex CLI, OpenAI Hybrid
- Model spec system with runtime config (reasoning, streaming, context window)
- Custom model testing and last-working-model fallback
- Provider-aware inference locking for local GPU protection

### Agent System
- 7 pro agents with specialized system prompts and memory
- 11+ sub-agents for delegated tasks
- Dual-mode subagent architecture (hidden worker runs + direct user chats)
- Provider-aware parallel batch execution
- File-backed subtask runs with durable state

### Plugin System
- Hot-loadable plugin lifecycle (enable/disable/reload/rollback)
- 7 bundled plugins (SearXNG, TTS bridge, Telegram relay, RAG studio, file browser, research UI, test)
- Plugin Studio UI for management and configuration
- Auto-generated knowledge items for LLM discoverability
- Capability contracts for plugin tool registration

### Workflow Engine
- File-first JSON workflow storage
- Auto-capture of successful tool chains
- Visual workflow editor with canvas
- Scheduled background workflow execution
- Run folder manifests with trace and results

### Knowledge & Memory
- File-first knowledge base with DB index
- Staged/active lifecycle with safety rules
- Background memory daemon with inference-driven summarization
- Daily and global memory files
- User profile observations

### Research Runtime
- Baseline vs variant experiment framework
- Research run store with manifests and artifact registry
- Research Orchestrator pro agent with dedicated UI

### UI/UX
- 8 built-in skins/themes with persistence
- Calendar and todo widgets
- Plugin management panel
- Agent picker widget
- Context window usage display
- TTS voice controls
- Chart renderer for data visualization

### Infrastructure
- Path token system for portable file references
- Secure API key storage via Electron safeStorage
- Event bus for typed system-wide events
- 35+ contract tests across 6 suite levels
- Docker support for headless testing

### Known Issues
- Electron runs with `nodeIntegration: true` (security hardening planned)
- Rule manager uses innerHTML (XSS surface)
- Tool chain has no context window truncation
- Vector store/embeddings exist but are not wired to knowledge search
