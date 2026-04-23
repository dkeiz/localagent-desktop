# Build Tasks: Plugins + Knowledge

## Phase 1: ServiceContainer
- [x] Create `src/main/service-container.js`
- [x] Refactor `main.js` — register all services into container
- [x] Refactor `ipc-handlers.js` — change signature to `(ipcMain, container)`
- [x] Smoke test — app starts, messages work

## Phase 2: Plugin System
- [ ] Create `plugins` table in `database.js`
- [ ] Create `src/main/plugin-manager.js`
- [ ] Wire PluginManager into `main.js`
- [ ] Add plugin IPC endpoints in `ipc-handlers.js`
- [ ] Auto-generate knowledge items when plugin enables
- [ ] Create `agentin/plugins/` directory
- [ ] Create test plugin for validation
- [ ] UI: Plugin widget in right column (index.html)
- [ ] UI: `plugin-panel.js` renderer component
- [ ] UI: Plugin widget styles in `layout.css`
- [ ] Smoke test — enable/disable plugin, handler registered/removed

## Phase 3: Knowledge Layer
- [ ] Create `knowledge_items` table in `database.js`
- [ ] Create `src/main/knowledge-manager.js`
- [ ] Create `agentin/knowledge/` directory structure
- [ ] Register `explore_knowledge` tool in `mcp-server.js`
- [ ] Add to agent tool group in `tool-classification.json`
- [ ] Add `<knowledge_guidance>` in `inference-dispatcher.js`
- [ ] Wire KnowledgeManager into `main.js`
- [ ] Add knowledge IPC endpoints in `ipc-handlers.js`
- [ ] Create seed knowledge items (application docs, capabilities)
- [ ] Daemon integration in `background-memory-daemon.js`
- [ ] Smoke test — explore_knowledge works, read_file reads knowledge
