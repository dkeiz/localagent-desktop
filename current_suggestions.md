# Current Suggestions

## Fixed In This Pass
1. `src/main/plugin-manager.js`
   Plugin handlers now register with `CapabilityManager`, so enabled plugins are executable instead of being blocked by `capability_group_disabled`.
2. `src/main/plugin-manager.js`
   Plugin enable failures now roll back partially registered handlers and leave the plugin in `error` state instead of leaking live tools.
3. `src/main/knowledge-manager.js`
   `rejectStaged()` now rejects only staged knowledge and refuses to delete records outside the staging tree.
4. `src/main/mcp-server.js`
   Removed the duplicate `run_command` registration and added duplicate tool registration protection.
5. `src/main/main.js`
   `explore_knowledge` now registers with `CapabilityManager`, so the tool is actually callable.
6. `src/renderer/electron-api.js`
   Restored the missing calendar/todo IPC bridge methods and event subscriptions.
7. `src/renderer/index.html`
   Restored the missing calendar events container and todo input controls required by the widgets.
8. `src/renderer/components/calendar.js`
   Repaired calendar widget wiring and removed raw HTML injection for event titles/descriptions.
9. `src/renderer/components/todos.js`
   Repaired todo widget wiring and removed raw HTML injection for task content.
10. `src/renderer/components/plugin-panel.js`
    Removed raw HTML rendering for plugin data and added proper error handling on enable/disable.
11. `src/renderer/components/sidebar.js`
    Fixed unsafe chat session rendering and preserved string session IDs for `--testclient` mode.
12. `src/renderer/components/message-formatter.js`
    Stopped it from clobbering assistant rendering and hardened its markdown output against obvious HTML/link injection.
13. `tests/` and `package.json`
    Added a real suite runner, contract tests, and a test ladder (`test:contracts`, `test:quick`, `test:core`, `test:live`, `test:all`, `verify`) so refactors can be done behind repeatable checks instead of ad hoc scripts only.
14. `src/main/mcp-server.js` and `src/main/mcp/`
    Split built-in MCP tool registration into domain registrars and reduced `mcp-server.js` to a compact orchestrator with duplicate-registry protection kept in place.
15. `src/renderer/components/main-panel.js`, `src/renderer/components/main-panel-tabs.js`, and `src/renderer/components/main-panel-permissions.js`
    Split the oversized main panel by moving chat-tab/session logic and tool-permission flow into dedicated helpers. The permission dialog no longer relies on inline `onclick` handlers.
16. `src/renderer/styles/layout.css` and `src/renderer/styles/layout/`
    Split the monolithic stylesheet into imported domain files so the line-budget rule now applies across the renderer without exceptions.
17. `tests/contracts/renderer-script-wiring-contract.test.js` and `tests/contracts/styles-layout-import-contract.test.js`
    Added explicit wiring checks for renderer helper scripts and stylesheet imports so the new modular structure is enforced by the contract suite.

## Still Not Clean
1. `src/main/main.js`
   Electron still runs with `nodeIntegration: true` and `contextIsolation: false`. With the current renderer surface, that keeps any missed XSS sink high impact.
2. `src/main/ipc/register-workflow-handlers.js`
   The workflow popup window also uses `nodeIntegration: true` and `contextIsolation: false`, so it inherits the same renderer risk profile.
3. `src/renderer/components/main-panel.js`
   The file is now under the line budget, but the chat message/attachment rendering paths still use string-built HTML and lightbox attribute interpolation. That needs a dedicated hardening pass.
4. `src/renderer/components/rule-manager.js`
   Rule names/content are still rendered through `innerHTML`, so user-authored prompt rules remain a stored injection surface.
5. `src/renderer/components/sidebar.js`
   Other sections in the sidebar still use string-built `innerHTML` for workflow/tool activity cards. Chat sessions are fixed, but the rest of the file still needs the same treatment.
6. `src/main/plugin-manager.js` and `src/main/main.js`
   Dynamic tool registration is still ad hoc. A single registry API for core/plugin/custom tools would prevent future capability drift.
7. `tests/contracts/`
   The backbone now exists, but the highest-risk renderer surfaces still need deeper coverage: `main-panel` rendering branches, `rule-manager`, remaining `sidebar` HTML rendering, and workflow window security boundaries.

## Suggested Next Order
1. Harden `src/renderer/components/main-panel.js` message rendering paths and add focused contracts for permission dialogs, tab restoration, and attachment rendering.
2. Harden `src/renderer/components/rule-manager.js` and the remaining string-built sections in `src/renderer/components/sidebar.js`.
3. Replace ad hoc dynamic tool registration with a single registry surface shared by core, plugin, and custom tools.
4. Replace insecure Electron renderer settings with a preload-based bridge once the renderer API surface is pinned by tests.
