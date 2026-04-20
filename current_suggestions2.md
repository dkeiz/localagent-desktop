# Critical Codebase Catches & Suggestions

This document compiles the critical architectural, logic, and code-level bugs identified during the backend review. These issues range from database spam and silent failures to infinite loops and context corruption.

## Part 1: Architectural & Lifecycle Flaws

### 1. App Quit Will Hang (or Corrupt Data)
**File:** `src/main/agent-loop.js`
*   **The Bug:** The `onAppQuit()` method loops through all active sessions and calls `await this.onSessionClose(sessionId)`. `onSessionClose` triggers a full LLM inference call (`this.dispatcher.dispatch`) to summarize the conversation.
*   **Why it's bad:** If you have active sessions when you click "Exit App", the backend attempts to run sequential LLM generations before it actually closes. The app will either hang for minutes, or the OS will forcefully kill the process mid-generation, corrupting the SQLite database or memory logs.
*   **The Fix:** When the app quits, bypass the LLM summary. Just forcefully save the raw chat state, and do the summarization asynchronously in a background daemon on the *next* startup.

### 2. Session Workspaces are Deleted Too Aggressively
**File:** `src/main/agent-loop.js`
*   **The Bug:** In `onSessionClose()`, you call `this.sessionWorkspace.cleanup(sessionId)`, which deletes all the temp files (logs, command outputs) generated during that session.
*   **Why it's bad:** If a user closes a chat, and then opens it again from history to continue the conversation, the LLM will still have context referencing those files (e.g., "I saved the build log to `{workspace}/build.log`"). If the user asks to look at that log again, the agent will crash/fail because the file was wiped when the session was temporarily closed.
*   **The Fix:** Only clean up session workspaces using the `cleanupStale(maxAgeDays = 30)` cron job in `session-workspace.js`. Do not wipe them the moment the chat window closes.

### 3. Database Spam on Every Generation
**File:** `src/main/inference-dispatcher.js`
*   **The Bug:** At the end of the `dispatch` function, `await this._rememberWorkingRuntimeParams(...)` is called. This executes an `UPDATE`/`INSERT` into the SQLite database (`saveModelRuntimeConfig`) after *every single inference call* just to save the context window size.
*   **Why it's bad:** Multiple subagents firing off rapid sequential tool queries will spam disk I/O with unnecessary database locks for a value that hasn't changed.
*   **The Fix:** Only write to the DB if the `contextLength` actually differs from what is currently cached in memory.

---

## Part 2: Hard Code-Level Bugs

### 4. `edit_file` Blindly Replaces the Wrong Code
**File:** `src/main/mcp/register-file-tools.js`
*   **The Bug:** `content = content.replace(search, replace);`
*   **Why it's bad:** In JavaScript, `String.replace()` only replaces the **very first occurrence** of the search string. If the LLM tries to edit a generic line (like `return true;`) and there are 5 instances of it (`matchCount = 5`), the tool replaces the 1st one at the top of the file, even if the LLM intended to edit the 4th one. 
*   **The Fix:** If `matchCount > 1`, the tool must **throw an error** telling the LLM: *"Target string is not unique (found X matches). Please provide more surrounding context lines in your search string to ensure uniqueness."*

### 5. Plugin Hot-Reload Only Clears Half the Cache
**File:** `src/main/plugin-manager.js`
*   **The Bug:** `delete require.cache[require.resolve(mainPath)];` only deletes the entry point from Node's cache.
*   **Why it's bad:** If a plugin is split into multiple files (e.g., `main.js` requires `api.js`), editing `api.js` and clicking "reload plugin" does nothing. Node reloads `main.js` but uses the stale, cached version of `api.js` forever until the app is restarted.
*   **The Fix:** Implement a recursive cache clearing function that finds all child modules originating from the plugin's directory and deletes them from `require.cache` before requiring `mainPath`.

### 6. Malformed Tool Calls Erase the Rest of the Message
**File:** `src/main/tool-chain-controller.js`
*   **The Bug:** The `stripToolPatterns` regex parser manually counts `{` and `}` depth. If the LLM forgets the final closing `}`, the `while (i < text.length)` loop runs to the end of the response and returns `'\x00'.repeat(...)`.
*   **Why it's bad:** If the parser hits EOF because of a missing bracket, it replaces the *entire remainder of the agent's message* with null bytes, which are then stripped. If the agent wrote a 500-word explanation after the broken tool call, the user will never see it—it is silently deleted.
*   **The Fix:** If the `while` loop finishes and `depth > 0` is still true (meaning it hit EOF without finding the closing brace), abort the replacement and return the original match string so the user can see the broken JSON and the text that followed it.

---

## Part 3: Logic & Background Agent Flaws

### 7. The Hallucinating Background Daemon
**File:** `src/main/background-memory-daemon.js`
*   **The Bug:** The background daemon queries the DB for unsummarized sessions (`SELECT id, title...`), but it **never actually fetches the conversation text!** 
*   **Why it's bad:** It passes the LLM a prompt saying: *"You have 10 unsummarized sessions. Write summaries for them."* The LLM will literally **hallucinate summaries of conversations it has never read** (making up stories based on the session title) and write those hallucinations into permanent memory.
*   **The Fix:** In `_executeTick()`, if the LLM chooses the summary task, query `this.db.getConversations(sessionId)`, append the raw chat logs to the prompt, and *then* ask the LLM to summarize it.

### 8. The Infinite Sub-Agent Spawn Loop
**File:** `src/main/tool-chain-controller.js`
*   **The Bug:** The duplicate tool-call detector (`_shouldSkipDuplicate`) prevents infinite loops, but `subagent` and `run_subagent` are explicitly in the `nonDedupeTools` bypass list.
*   **Why it's bad:** `this.maxChainSteps` defaults to `Number.POSITIVE_INFINITY`. If an agent gets confused and blindly retries `TOOL:subagent{"action":"run", "id":"researcher"}`, the duplicate detector ignores it, and the chain loop never terminates. It will spawn **infinite subagents** until RAM runs out or API bills explode.
*   **The Fix:** Set a hardcoded safety limit for `this.maxChainSteps` (e.g., 15) in the constructor instead of `Infinity`. 

### 9. The Tool Chain "Context Bomb"
**File:** `src/main/tool-chain-controller.js`
*   **The Bug:** `workingHistory` grows infinitely inside the `executeWithChaining` loop as new tool calls and results are appended.
*   **Why it's bad:** There is no context window management. If an agent does 10 tool calls that output large files, `workingHistory` balloons. On the 11th step, it exceeds the LLM's `max_tokens` limit, throwing an error and crashing the entire chain, losing all progress.
*   **The Fix:** Before calling `dispatcher.dispatch()` inside the loop, implement a truncation function that drops the oldest tool results from `workingHistory` if the token count gets too high.
