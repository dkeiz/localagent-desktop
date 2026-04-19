# Current Suggestions

## Part 1 SuperAgent Foundation Ready
1. Agent-owned folders now include `tasks/` and `outputs/` for all agents.
2. File tools support portable path tokens such as `{agent_home}`, `{agent_tasks}`, `{agent_outputs}`, and `{workspace}`.
3. `edit_file` gives agents exact search/replace editing without full-file overwrites.
4. `subagent action="run_batch"` starts provider-aware batches while queueing same-provider work.
5. Agent-bound plugins can contribute chat-tab UI, CSS, actions, and activation/deactivation hooks.
6. The Research Orchestrator is seeded as a normal pro agent, with a dedicated UI plugin plus the shared artifact/file browser.
7. Chat tabs now have a small built-in chart renderer that plugins and messages can use through declarative chart JSON, so charts are a UI capability rather than a separate chart plugin.

## Verified In This Pass
1. `tests/contracts/agent-chat-ui-contract.test.js`
   Covers multiple UI plugins on one agent, plugin CSS composition, action routing, file-preview action behavior, and lifecycle event delivery.
2. `tests/contracts/plugin-lifecycle-contract.test.js`
   Extended to cover agent-bound plugin lookup, multiple companion plugins, chat UI rendering, and UI action refresh.
3. `tests/contracts/chat-chart-renderer-contract.test.js`
   Covers chart spec normalization, renderer hydration, and chart fences in chat messages.
4. `tests/contracts/edit-file-tool-contract.test.js`
   Covers tokenized writes plus exact multi-edit behavior and skipped edits.
5. `tests/contracts/path-token-contract.test.js`
   Covers agent/workspace token construction and resolution.
6. `tests/contracts/subagent-batch-contract.test.js`
   Covers provider grouping metadata and queue-provider routing.
7. `tests/contracts/mcp-tool-inventory-contract.test.js`
   Confirms `edit_file` is now an intentional MCP inventory addition.
8. `tests/contracts/line-budget-contract.test.js`
   Confirms touched source/test files remain under the line budget.

## Suggested Next Part: Research Runtime And Artifact Model
1. Add a durable research run manifest under `agentin/research/runs/<runId>/` with goal, acceptance criteria, task matrix, provider/model settings, spawned subagents, artifacts, scores, and final recommendation.
2. Add an artifact registry used by agent UIs: markdown, HTML, CSV, JSON, chart specs, screenshots, and generated media should have metadata, owner agent/folder, parent run, and preview type. Privacy should come from the owning folder/root, not per-artifact UI hiding.
3. Add acceptance criteria prompts and validators so the Research Orchestrator can decide whether results are acceptable, need rerun, or need the user to clarify success conditions.
4. Add per-agent provider/runtime overrides in agent config so batch research can intentionally compare models/providers instead of only queueing by discovered config.
5. Add `--testuser` and `--privateuser` profile behavior before wider automation: separate storage roots, folder-owner export policy, and a scrubber at root/export boundaries.
6. Add headless research CLI mode that can start a Research Orchestrator run, stream status, and emit final artifacts without opening the Electron UI.
7. Extend the Research Orchestrator UI plugin around the shared chart renderer: let the plugin decide which charts, tables, files, and summaries belong in its tab layout, while the renderer only supplies the primitive.
8. Add agent-created plugin draft flow: generate plugin files into a disabled draft area, validate schema/actions, then require explicit promotion before execution.
9. Add sandbox/runtime policy for code-oriented subagents: workspace root, allowed tools, terminal policy, and optional Docker runner later.
10. After the research loop is stable, wire speech/TTS/STT and Telegram delivery as plugins around runs and artifacts, not inside the core agent manager.

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
18. `src/main/agent-manager.js`, `src/main/subtask-runtime.js`, `src/main/tool-chain-controller.js`, `src/main/mcp-server.js`, and `src/main/mcp/register-agent-tools.js`
    Reworked delegated sub-agent runs into an async, file-backed runtime: `delegate_to_subagent` now returns an immediate acknowledgment, delegated runs write durable files under `agentin/subtasks/`, completions autosend back to the parent session, and MCP now exposes `get_subagent_run` alongside the existing delegation tools.
19. `src/renderer/components/message-formatter.js`, `src/renderer/components/main-panel.js`, `src/renderer/components/main-panel-tabs.js`, and chat styles
    Reworked chat rendering and scrolling: assistant messages now go through a single formatter with markdown/thinking blocks, image/lightbox handling no longer uses inline click handlers, tab scroll position is preserved, and PageDown now advances the chat viewport without adding extra UI controls.
20. `tests/contracts/subagent-contract.test.js`
    Added a contract test covering sub-agent delegation, completion contract handling, artifact merging, and active/idle lifecycle updates.
21. `subagent-architecture.md`
    Added a short architecture note separating delegated subtask runs from direct user-opened subagent chats so later refactors keep those semantics distinct.
22. `tests/contracts/mcp-session-context-contract.test.js`
    Added a contract test for per-call MCP session context so delegated background runs keep their own workspace/session scope instead of leaking through the global active chat session.

## Still Not Clean
1. `src/main/main.js`
   Electron still runs with `nodeIntegration: true` and `contextIsolation: false`. With the current renderer surface, that keeps any missed XSS sink high impact.
2. `src/main/ipc/register-workflow-handlers.js`
   The workflow popup window also uses `nodeIntegration: true` and `contextIsolation: false`, so it inherits the same renderer risk profile.
3. `src/renderer/components/main-panel.js`
   The file is now under the line budget and safer than before, but tab state still stores raw `messagesHTML`, which keeps restoration coupled to rendered markup instead of message data.
4. `src/renderer/components/rule-manager.js`
   Rule names/content are still rendered through `innerHTML`, so user-authored prompt rules remain a stored injection surface.
5. `src/renderer/components/sidebar.js`
   Other sections in the sidebar still use string-built `innerHTML` for workflow/tool activity cards. Chat sessions are fixed, but the rest of the file still needs the same treatment.
6. `src/main/plugin-manager.js` and `src/main/main.js`
   Dynamic tool registration is still ad hoc. A single registry API for core/plugin/custom tools would prevent future capability drift.
7. `tests/contracts/`
   The backbone now exists, but the highest-risk surfaces still need deeper coverage: delegated sub-agent runs through the full chain controller, `main-panel` rendering branches, `rule-manager`, remaining `sidebar` HTML rendering, and workflow window security boundaries.

## Suggested Next Order
1. Replace raw `messagesHTML` tab persistence with structured message state, then add focused contracts for tab restoration and scroll behavior.
2. Harden `src/renderer/components/rule-manager.js` and the remaining string-built sections in `src/renderer/components/sidebar.js`.
3. Replace ad hoc dynamic tool registration with a single registry surface shared by core, plugin, and custom tools.
4. Replace insecure Electron renderer settings with a preload-based bridge once the renderer API surface is pinned by tests.
