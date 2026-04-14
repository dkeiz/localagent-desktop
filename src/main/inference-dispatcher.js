const path = require('path');
const { getModelRuntimeConfig, saveModelRuntimeConfig, sanitizeRuntimeConfig } = require('./llm-config');
const { getEffectiveLlmSelection } = require('./llm-state');

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
        this.agentManager = null;

        // Simple mutex to prevent concurrent inference calls from racing
        this._lock = null;
        this._lockMode = null;
        this._lockPreemptible = false;
    }

    setAgentManager(agentManager) {
        this.agentManager = agentManager;
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
        const preemptible = options.preemptible === true;
        const provider = this.aiService.getCurrentProvider();

        // Decide what to inject based on mode (callers can override)
        const includeTools = options.includeTools ?? (mode === 'chat');
        const includeRules = options.includeRules ?? (mode === 'chat');
        const includeEnv = mode === 'chat' || mode === 'internal';

        // Resolve model once here (not in each adapter)
        if (!options.model) {
            const { model } = await getEffectiveLlmSelection(this.db);
            if (model) options.model = model;
        }

        // Read thinking mode settings
        if (!options.runtimeConfig && options.model) {
            const { spec, runtime } = await getModelRuntimeConfig(
                this.db,
                provider,
                options.model
            );
            options.modelSpec = spec;
            options.runtimeConfig = runtime;
        }

        if (options.modelSpec && options.runtimeConfig) {
            options.runtimeConfig = await this._applyUiRuntimeOverrides(options.modelSpec, options.runtimeConfig);
        }

        if (!options.thinkingMode) {
            if (options.runtimeConfig?.reasoning) {
                options.thinkingMode = options.runtimeConfig.reasoning.enabled ? 'think' : 'off';
            }
            const thinkingMode = await this.db.getSetting('llm.thinkingMode');
            if (!options.runtimeConfig?.reasoning && thinkingMode && thinkingMode !== 'off') {
                options.thinkingMode = thinkingMode;
            }
        }

        // Build system prompt (with optional agent override)
        const agentId = options.agentId || null;
        const systemPrompt = await this._buildSystemPrompt({
            includeTools,
            includeRules,
            includeEnv,
            sessionId: options.sessionId,
            agentId,
            completionTools: options.completionTools || []
        });

        // Assemble messages array
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            ...(prompt ? [{ role: 'user', content: prompt }] : [])
        ];

        // Foreground chat can preempt low-priority internal/background calls.
        if (mode === 'chat' && this._lock && this._lockPreemptible) {
            const stopped = this.aiService.stopGeneration();
            if (stopped) {
                console.log(`[Dispatcher] Preempted ${this._lockMode || 'background'} inference for foreground chat`);
            }
        }

        // Acquire lock — serializes concurrent calls so they don't race
        await this._acquireLock();
        try {
            this._lockMode = mode;
            this._lockPreemptible = preemptible;
            console.log(`[Dispatcher] mode=${mode} model=${options.model || 'default'} tools=${includeTools} rules=${includeRules} historyLen=${history.length}`);
            const response = await this.aiService.sendMessage(messages, options);
            await this._rememberWorkingRuntimeParams(provider, options.model, options.modelSpec, options.runtimeConfig, response);
            return response;
        } finally {
            this._lockMode = null;
            this._lockPreemptible = false;
            this._releaseLock();
        }
    }

    async _applyUiRuntimeOverrides(modelSpec, runtimeConfig = {}) {
        const effectiveRuntime = JSON.parse(JSON.stringify(runtimeConfig || {}));
        const contextCaps = modelSpec?.capabilities?.contextWindow || {};
        if (!contextCaps.configurable) {
            return effectiveRuntime;
        }

        const savedContext = await this.db.getSetting('context_window');
        const parsedContext = Number.parseInt(savedContext, 10);
        if (Number.isFinite(parsedContext) && parsedContext > 0) {
            effectiveRuntime.contextWindow = { value: parsedContext };
        }

        return sanitizeRuntimeConfig(modelSpec, effectiveRuntime);
    }

    async _rememberWorkingRuntimeParams(provider, model, modelSpec, runtimeConfig, response) {
        if (!provider || !model || !modelSpec || response?.stopped) {
            return;
        }

        const contextCaps = modelSpec.capabilities?.contextWindow || {};
        const contextLength = runtimeConfig?.contextWindow?.value || response?.context_length;
        if (contextCaps.configurable && contextLength) {
            await saveModelRuntimeConfig(this.db, provider, model, {
                contextWindow: { value: contextLength }
            });
        }
    }

    // ------- system prompt construction -------

    async _buildSystemPrompt({ includeTools, includeRules, includeEnv, sessionId, agentId, completionTools = [] }) {
        let prompt;

        // If dispatching for a specific agent, use agent's system prompt
        if (agentId && this.agentManager) {
            const agent = await this.agentManager.getAgent(agentId);
            if (agent) {
                prompt = this.agentManager.getAgentSystemPrompt(agent);
                // Prepend compact memory if available
                const memory = this.agentManager.getAgentMemory(agent);
                if (memory) {
                    prompt = `<agent_memory>
${memory}
</agent_memory>

${prompt}`;
                }
            } else {
                prompt = this.aiService.systemPrompt;
            }
        } else {
            prompt = this.aiService.systemPrompt;
        }

        // Environment paths (useful for chat + internal modes)
        if (includeEnv) {
            const appDir = path.resolve(__dirname, '..', '..');
            const sid = sessionId || 'default';
            prompt += `\n\n<environment>
Working Directory: ${appDir}
Memory Directory: ${path.join(appDir, 'agentin', 'memory')}
Session Workspace: ${path.join(appDir, 'agentin', 'workspaces', String(sid))}
Agent Config: ${path.join(appDir, 'agentin')}
When using file tools (list_directory, read_file, etc.), use these paths. Your memory files are in the agentin/memory/ directory.
</environment>

<workspace_guidance>
For commands with potentially large output (builds, installs, logs, directory trees):
- Use output_to_file=true in run_command to save output to a workspace file (auto-triggers at 1000+ chars)
- Then use read_file or search_workspace to inspect specific parts
- This keeps your context window lean and avoids token waste
Your session workspace is personal and auto-cleaned on session close.
</workspace_guidance>

<memory_on_start>
IMPORTANT: At the start of every new conversation, you MUST read your core memory files using the read_file tool BEFORE answering the user. This is how you remember who you are and who the user is.

Read these files (use read_file tool):
1. ${path.join(appDir, 'agentin', 'agent.md')} — your identity and technical reference
2. ${path.join(appDir, 'agentin', 'userabout', 'memoryaboutuser.md')} — what you know about the user
3. ${path.join(appDir, 'agentin', 'memory', 'global', 'preferences.md')} — permanent preferences
4. ${path.join(appDir, 'agentin', 'memory', 'daily')} — use list_directory then read today's log
5. ${path.join(appDir, 'agentin', 'workflows', 'workflow.md')} — workflow system reference

Do this silently as part of your first response. You must still answer the user's question in the same turn — chain the file reads then respond naturally.
</memory_on_start>

<knowledge_guidance>
You have a personal knowledge store at ${path.join(appDir, 'agentin', 'knowledge')}.
Use explore_knowledge to see what's available, then read_file to access specific items.
Knowledge includes: user preferences, usage patterns, plugin guides, contacts, and more.
Explore on-demand when the user's request suggests prior context would help.
Each knowledge file is max 200 lines. Use existing file tools to read and search within.
</knowledge_guidance>`;
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
            prompt += await this._buildToolContext(completionTools);
        }

        return prompt;
    }

    async _buildToolContext(completionToolNames = []) {
        const activeTools = this.mcpServer.getActiveTools
            ? this.mcpServer.getActiveTools()
            : [];
        const visibleTools = activeTools.length > 0
            ? activeTools
            : this.mcpServer.getTools();
        const completionTools = this.mcpServer.getToolsByNames
            ? this.mcpServer.getToolsByNames(completionToolNames, { includeInternal: true })
            : [];
        const tools = [...visibleTools];

        for (const tool of completionTools) {
            if (!tools.some(existing => existing.name === tool.name)) {
                tools.push(tool);
            }
        }

        let ctx = `\n\n<mcp_tools>\nAvailable Tools (from active groups):\n\n`;

        for (const tool of tools) {
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

            if (tool.name === 'subagent') {
                const subagents = this.agentManager ? await this.agentManager.getAgents('sub') : [];
                if (subagents.length > 0) {
                    ctx += `Live Sub-agents:\n`;
                    subagents.forEach(agent => {
                        ctx += `  - id=${agent.id}, name="${agent.name}", status=${agent.status || 'idle'}\n`;
                    });
                } else {
                    ctx += `Live Sub-agents: none configured right now\n`;
                }
                ctx += `Use action="list" if you need the current ids. Prefer id over name for action="run".\n`;
            }

            ctx += `\n`;
        }

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
