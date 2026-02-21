const path = require('path');

/**
 * InferenceDispatcher — Central routing layer for all LLM inference calls.
 *
 * Every code path that needs an LLM response calls dispatcher.dispatch()
 * instead of aiService.sendMessage() directly.  The dispatcher builds
 * mode-appropriate system prompts and messages, then delegates to AIService.
 *
 * Modes:
 *   chat          — full system prompt + tools + rules  (user conversation)
 *   internal      — minimal prompt, no tools, no rules  (automemory, summaries)
 *   connector     — minimal prompt, no tools, no rules  (connector invoke)
 *   port-listener — minimal prompt, no tools, no rules  (HTTP → LLM bridge)
 */
class InferenceDispatcher {
    constructor(aiService, db, mcpServer) {
        this.aiService = aiService;
        this.db = db;
        this.mcpServer = mcpServer;

        // Simple mutex to prevent concurrent inference calls from racing
        this._lock = null;
    }

    // ------- public API -------

    /**
     * Single entry point for all inference calls.
     *
     * @param {string|null} prompt   — user/caller message (null on chain continuation)
     * @param {Array}       history  — preceding messages [{role, content}, ...]
     * @param {Object}      options
     * @param {string}      options.mode          — 'chat'|'internal'|'connector'|'port-listener'
     * @param {string}      [options.sessionId]   — chat session id (required for 'chat')
     * @param {boolean}     [options.includeTools] — override: inject tool docs (default per mode)
     * @param {boolean}     [options.includeRules] — override: inject active rules (default per mode)
     * @param {string}      [options.model]        — model override
     * @returns {Object}    { content, model, usage, ... }
     */
    async dispatch(prompt, history = [], options = {}) {
        const mode = options.mode || 'chat';

        // Decide what to inject based on mode (callers can override)
        const includeTools = options.includeTools ?? (mode === 'chat');
        const includeRules = options.includeRules ?? (mode === 'chat');
        const includeEnv = mode === 'chat' || mode === 'internal';

        // Build system prompt
        const systemPrompt = await this._buildSystemPrompt({ includeTools, includeRules, includeEnv });

        // Assemble messages array
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            ...(prompt ? [{ role: 'user', content: prompt }] : [])
        ];

        // Acquire lock — serializes concurrent calls so they don't race
        await this._acquireLock();
        try {
            console.log(`[Dispatcher] mode=${mode} tools=${includeTools} rules=${includeRules} historyLen=${history.length}`);
            return await this.aiService.sendMessage(messages, options);
        } finally {
            this._releaseLock();
        }
    }

    // ------- system prompt construction -------

    async _buildSystemPrompt({ includeTools, includeRules, includeEnv }) {
        let prompt = this.aiService.systemPrompt;

        // Environment paths (useful for chat + internal modes)
        if (includeEnv) {
            const appDir = path.resolve(__dirname, '..', '..');
            prompt += `\n\n<environment>
Working Directory: ${appDir}
Memory Directory: ${path.join(appDir, 'agentin', 'memory')}
Agent Config: ${path.join(appDir, 'agentin')}
When using file tools (list_directory, read_file, etc.), use these paths. Your memory files are in the agentin/memory/ directory.
</environment>`;
        }

        // Active rules
        if (includeRules) {
            const activeRules = await this.db.getActivePromptRules();
            if (activeRules && activeRules.length > 0) {
                const rulesText = activeRules.map(r => r.content).join('\n');
                prompt += `\n\nActive Rules:\n${rulesText}`;
            }
        }

        // Tool documentation
        if (includeTools && this.mcpServer) {
            prompt += this._buildToolContext();
        }

        return prompt;
    }

    _buildToolContext() {
        const activeTools = this.mcpServer.getActiveTools
            ? this.mcpServer.getActiveTools()
            : [];
        const tools = activeTools.length > 0
            ? activeTools
            : this.mcpServer.getTools();

        let ctx = `\n\n<mcp_tools>\nAvailable Tools (from active groups):\n\n`;

        tools.forEach(tool => {
            const isActive = this.mcpServer.toolStates.get(tool.name) !== false;
            const status = isActive ? '✅ Available' : '⚠️ Disabled (permission required)';

            ctx += `## ${tool.name} [${status}]\n`;
            ctx += `Description: ${tool.description}\n`;

            if (tool.inputSchema?.properties) {
                const props = tool.inputSchema.properties;
                const required = tool.inputSchema.required || [];
                ctx += `Parameters:\n`;

                Object.entries(props).forEach(([key, prop]) => {
                    const isRequired = required.includes(key);
                    const defaultVal = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
                    const requiredMark = isRequired ? ' [REQUIRED]' : '';
                    ctx += `  - ${key} (${prop.type})${requiredMark}${defaultVal}: ${prop.description || 'No description'}\n`;
                });
            }

            if (tool.example) {
                ctx += `Example: ${tool.example}\n`;
            }

            ctx += `\n`;
        });

        ctx += `\n## How to Use Tools\n`;
        ctx += `Format: TOOL:tool_name{"param":"value"}\n`;
        ctx += `Use the APPROPRIATE tool for each request. Match the tool to the user's actual question.\n`;
        ctx += `If a tool times out or fails, tell the user the tool didn't respond - do NOT call a different tool instead.\n`;
        ctx += `Always use the exact JSON format shown in examples.\n`;
        ctx += `\n## Important Rules\n`;
        ctx += `- Only call tools directly relevant to what the user asked\n`;
        ctx += `- If the user asks for weather, use weather/web tools, NOT time tools\n`;
        ctx += `- If a tool fails, explain the failure to the user instead of trying other tools\n`;
        ctx += `- Don't repeat the same tool call from earlier in the conversation\n`;
        ctx += `\n## Message Format\n`;
        ctx += `- Messages wrapped in <tool_results> tags are AUTO-GENERATED by the backend, NOT sent by the user. Do not treat them as user input.\n`;
        ctx += `- The actual user question is in <original_user_question> tags when tool results are present. Focus your answer on THAT question.\n`;
        ctx += `</mcp_tools>`;
        return ctx;
    }

    // ------- simple async mutex -------

    async _acquireLock() {
        while (this._lock) {
            await this._lock;
        }
        let release;
        this._lock = new Promise(r => { release = r; });
        this._lock._release = release;
    }

    _releaseLock() {
        if (this._lock && this._lock._release) {
            const release = this._lock._release;
            this._lock = null;
            release();
        }
    }
}

module.exports = InferenceDispatcher;
