# Code Review: Path Tokenization and MCP Path Leaks
was solved with partial testing

## Synced Inventory (2026-04-21)

### Resolved in code
1. System prompt path leaks in `src/main/inference-dispatcher.js`
   - `<environment>`, `<memory_on_start>`, and knowledge guidance now use tokens (`{agentin}`, `{memory}`, `{workspace}`, `{knowledge}`).
   - `<path_tokens>` no longer prints absolute path values.
2. Missing reverse tokenization in `src/main/path-tokens.js`
   - Added `tokenizePath()` for absolute -> tokenized forward-slash output.
3. File tool absolute path leaks in `src/main/mcp/register-file-tools.js`
   - `read_file`, `write_file`, `edit_file`, `list_directory`, `file_exists`, `delete_file` now return tokenized paths.
4. Terminal/workspace path leaks in `src/main/mcp/register-terminal-tools.js`
   - `run_command` returns tokenized `cwd` and `file_path`.
   - `list_workspace` and `search_workspace` return tokenized paths.
   - tokenized `cwd`/`scriptPath` input resolution added.
5. Prompt tool path leaks in `src/main/mcp/register-prompt-tools.js`
   - `modify_system_prompt` and `manage_rule` now return tokenized paths.
6. Connector tool path leak in `src/main/mcp/register-connector-tools.js`
   - `connector_op` with `action=create` now returns tokenized `path`.
7. Media tool path leaks in `src/main/mcp/register-media-tools.js`
   - `get_image_info`, `open_media`, `play_audio`, `view_image`, `screenshot` now resolve tokenized input paths and return tokenized output paths.
8. Web download path leak in `src/main/mcp/register-web-system-tools.js`
   - `download_file` now resolves tokenized `savePath` and returns tokenized `savedTo`.
9. JSON Windows path repair fragility in `src/main/mcp-server.js`
   - `_repairJsonForWindowsPaths` made more robust for malformed Windows literals.

### Remaining issues to solve
1. No known remaining absolute-path leaks in MCP tool outputs or the audited IPC agent file handlers.
2. Non-tokenized runtime internals still exist in many modules (`agent-memory`, `knowledge-manager`, workflow/research runtimes, etc.).
   - These are backend filesystem internals (not exposed MCP outputs in this audit), but should be reviewed if any new UI/tool surfaces expose them later.

### Test status
- Focused contract testing completed:
  - `path-token-contract` PASS
  - `path-boundary-contract` PASS
  - `path-portable-tools-contract` PASS
  - `ipc-agent-path-portability-contract` PASS
- No full-suite run was executed.

After a deep dive into the recent file-based architecture refactoring and the MCP tool handling, I have found a systemic issue with how paths are handled. The core issue is that while the system *accepts* localized portable path tokens (like `{agentin}`, `{workspace}`), it **always returns absolute paths** back to the agent. 

On a Russian OS, these absolute paths often contain Cyrillic characters (e.g., `C:\Users\Кириллица\...`) and Windows backslashes (`\`). When the agent sees these absolute paths in tool responses, it attempts to use them instead of the portable tokens, which frequently leads to JSON string escaping errors and broken tool calls.

Here is an exhaustive breakdown of everything touching these path concerns:

## 1. System Prompt Leaks Absolute Paths Early
**File:** `src/main/inference-dispatcher.js`
*   **The Issue:** Inside `_buildSystemPrompt`, the `<environment>` and `<memory_on_start>` blocks hardcode absolute paths using `path.join(appDir, ...)`.
*   **Impact:** The prompt explicitly tells the LLM: *"Read these files: C:\Users\Username\...\agentin.md"*. This forces the agent to deal with absolute paths on its very first interaction, completely undermining the `<path_tokens>` instruction provided later.
*   **Fix:** Replace the `path.join(appDir, ...)` references with the portable tokens. For example: `1. {agentin}/agent.md — your identity and technical reference`.

## 2. Missing "Unresolve" Logic in Token Engine
**File:** `src/main/path-tokens.js`
*   **The Issue:** The token engine can `resolvePathTokens` (Token -> Absolute), but there is no `unresolvePathTokens` or `tokenizePath` function (Absolute -> Token).
*   **Impact:** The backend has no central utility to sanitize tool outputs. Furthermore, `path.normalize(resolved)` naturally converts forward slashes to backslashes on Windows. Without an "unresolve" step that forces forward slashes (`/`), Windows path formatting constantly leaks back to the agent.

## 3. File Tools Expose Absolute Paths
**File:** `src/main/mcp/register-file-tools.js`
*   **The Issue:** Every single file tool resolves the path to do `fs` operations, but returns the *resolved absolute path* in the tool output. 
*   **Worst Offender (`list_directory`):** When an agent lists a directory, it receives an array of items where every `path` property is an absolute string (`path: path.join(dirPath, item.name)`). The agent inevitably copy-pastes these absolute paths into the next tool call.
*   **Fix:** Apply a new `tokenizePath(absolutePath)` function to the `path` properties returned by `read_file`, `write_file`, `edit_file`, `list_directory`, `file_exists`, and `delete_file`.

## 4. Terminal & Workspace Tools Expose Absolute Paths
**Files:** `src/main/mcp/register-terminal-tools.js` & `src/main/session-workspace.js`
*   **The Issue:** The `run_command` tool accepts a `cwd`, but returns `cwd: options.cwd` (which resolves to absolute). If `output_to_file` is triggered, it returns an absolute `file_path`.
*   **Workspace Leaks:** `list_workspace` and `search_workspace` both rely on `server._sessionWorkspace.listFiles()` and `searchFiles()`, which return absolute `path: fp` properties.
*   **Fix:** Update `session-workspace.js` output models, or sanitize the results in `register-terminal-tools.js` so that `file_path` and `cwd` are mapped back to `{workspace}/...`.

## 5. Brittle JSON Path Repair
**File:** `src/main/mcp-server.js`
*   **The Issue:** The `_repairJsonForWindowsPaths` function exists solely because the LLM struggles to properly escape Windows backslashes in JSON payloads. 
*   **Impact:** If the LLM were only dealing with forward-slashed portable tokens (`{workspace}/logs/output.log`), this JSON formatting issue would virtually disappear. Blindly replacing `\` with `\\` is a band-aid over the root cause and can fail if the LLM hallucinated Cyrillic escaping.

## Summary of Next Steps
To solve this permanently, the architecture needs a strong boundary: **The LLM should only ever read and write forward-slashed path tokens.**

1.  Write an `unresolvePathTokens(absolutePath, tokensMap)` function in `path-tokens.js` that loops over known tokens (like `{agent_home}`, `{workspace}`, `{agentin}`) and replaces the absolute root with the token string, ensuring the result uses `/`.
2.  Wrap the return payloads in `register-file-tools.js`, `register-terminal-tools.js`, and `register-prompt-tools.js` with this un-resolve function.
3.  Clean up the hardcoded absolute strings in `inference-dispatcher.js`.
