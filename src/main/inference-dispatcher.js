const { getModelRuntimeConfig, saveModelRuntimeConfig, sanitizeRuntimeConfig } = require('./llm-config');
const { getEffectiveLlmSelection } = require('./llm-state');
const { buildPathTokenMap } = require('./path-tokens');

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

        this._lockMode = null;
        this._lockPreemptible = false;
        this._laneLocks = new Map();
        this._runtimeContextCache = new Map();
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
        const provider = String(options.provider || this.aiService.getCurrentProvider() || 'ollama').trim().toLowerCase() || 'ollama';
        const concurrencyMode = this._normalizeConcurrencyMode(
            options.concurrencyMode || options.concurrency_mode || (options.skipLock ? 'parallel' : 'queued')
        );

        // Decide what to inject based on mode (callers can override)
        const includeTools = options.includeTools ?? (mode === 'chat');
        const includeRules = options.includeRules ?? (mode === 'chat');
        const includeEnv = options.includeEnv ?? (mode === 'chat' || mode === 'internal');
        const skipMemoryOnStart = options.skipMemoryOnStart === true;

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

        const scheduling = await this._resolveSchedulingDecision({
            provider,
            mode,
            concurrencyMode,
            modelSpec: options.modelSpec,
            runtimeConfig: options.runtimeConfig
        });

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
            skipMemoryOnStart,
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

        const execute = async () => {
            this._lockMode = mode;
            this._lockPreemptible = preemptible;
            console.log(`[Dispatcher] mode=${mode} model=${options.model || 'default'} tools=${includeTools} rules=${includeRules} provider=${provider} concurrency=${scheduling.effectiveMode} lane=${scheduling.laneKey || 'none'} historyLen=${history.length}`);
            const response = await this.aiService.sendMessage(messages, { ...options, provider });
            response.renderContext = {
                provider,
                model: options.model || response.model || '',
                runtimeConfig: options.runtimeConfig ? JSON.parse(JSON.stringify(options.runtimeConfig)) : null,
                concurrency: {
                    requestedMode: scheduling.requestedMode,
                    effectiveMode: scheduling.effectiveMode,
                    needsEnablement: scheduling.needsEnablement
                }
            };
            response.concurrency = {
                requested_mode: scheduling.requestedMode,
                effective_mode: scheduling.effectiveMode,
                provider,
                lane: scheduling.laneKey || null,
                global_enabled: scheduling.globalEnabled,
                needs_enablement: scheduling.needsEnablement
            };
            await this._rememberWorkingRuntimeParams(provider, options.model, options.modelSpec, options.runtimeConfig, response);
            return response;
        };

        try {
            return await this._executeScheduled(scheduling.laneKey, execute);
        } finally {
            this._lockMode = null;
            this._lockPreemptible = false;
        }
    }

    async _resolveSchedulingDecision({ provider, mode, concurrencyMode, modelSpec, runtimeConfig }) {
        const globalEnabled = (await this.db.getSetting('llm.concurrency.enabled')) === 'true';
        const concurrencyCaps = modelSpec?.capabilities?.concurrency || {};
        const providerSupportsParallel = Boolean(concurrencyCaps.supported);
        const providerAllowsParallel = Boolean(runtimeConfig?.concurrency?.allowParallel);
        const requestedMode = concurrencyMode || 'queued';

        if (requestedMode !== 'parallel') {
            return {
                requestedMode,
                effectiveMode: 'queued',
                laneKey: '__global__',
                globalEnabled,
                needsEnablement: false
            };
        }

        if (!globalEnabled) {
            return {
                requestedMode,
                effectiveMode: 'queued',
                laneKey: '__global__',
                globalEnabled,
                needsEnablement: true
            };
        }

        if (providerSupportsParallel && providerAllowsParallel) {
            return {
                requestedMode,
                effectiveMode: 'parallel',
                laneKey: null,
                globalEnabled,
                needsEnablement: false
            };
        }

        return {
            requestedMode,
            effectiveMode: 'queued',
            laneKey: `provider:${provider || 'default'}`,
            globalEnabled,
            needsEnablement: false
        };
    }

    _normalizeConcurrencyMode(value) {
        const mode = String(value || '').trim().toLowerCase();
        return mode === 'parallel' ? 'parallel' : 'queued';
    }

    async _executeScheduled(laneKey, work) {
        if (!laneKey) {
            return work();
        }
        const previous = this._laneLocks.get(laneKey) || Promise.resolve();
        const queued = previous.catch(() => null).then(() => work());
        const lanePending = queued.finally(() => {
            if (this._laneLocks.get(laneKey) === lanePending) {
                this._laneLocks.delete(laneKey);
            }
        });
        this._laneLocks.set(laneKey, lanePending);
        return lanePending;
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
            const normalizedLength = Number(contextLength);
            if (!Number.isFinite(normalizedLength) || normalizedLength <= 0) {
                return;
            }
            const cacheKey = `${provider}:${model}`;
            const cachedLength = this._runtimeContextCache.get(cacheKey);
            if (cachedLength === normalizedLength) {
                return;
            }
            if (cachedLength === undefined && runtimeConfig?.contextWindow?.value === normalizedLength) {
                this._runtimeContextCache.set(cacheKey, normalizedLength);
                return;
            }
            await saveModelRuntimeConfig(this.db, provider, model, {
                contextWindow: { value: normalizedLength }
            });
            this._runtimeContextCache.set(cacheKey, normalizedLength);
        }
    }

    // ------- system prompt construction -------

    async _buildSystemPrompt({ includeTools, includeRules, includeEnv, skipMemoryOnStart = false, sessionId, agentId, completionTools = [] }) {
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
            prompt += `\n\n<environment>
Working Directory: {agentin}
Memory Directory: {memory}
Session Workspace: {workspace}
Agent Config: {agentin}
When using file tools (list_directory, read_file, etc.), use these paths. Your memory files are in the agentin/memory/ directory.
</environment>

<workspace_guidance>
For commands with potentially large output (builds, installs, logs, directory trees):
- Use output_to_file=true in run_command to save output to a workspace file (auto-triggers at 1000+ chars)
- Then use read_file or search_workspace to inspect specific parts
- This keeps your context window lean and avoids token waste
Your session workspace is personal and cleaned by stale-workspace retention.
</workspace_guidance>

${skipMemoryOnStart ? '' : `<memory_on_start>
IMPORTANT: At the start of every new conversation, you MUST read your core memory files using the read_file tool BEFORE answering the user. This is how you remember who you are and who the user is.

Read these files (use read_file tool):
1. {agentin}/agent.md — your identity and technical reference
2. {agentin}/userabout/memoryaboutuser.md — what you know about the user
3. {memory}/global/preferences.md — permanent preferences
4. {memory}/daily — use list_directory then read today's log
5. {agentin}/workflows/workflow.md — workflow system reference

Do this silently as part of your first response. You must still answer the user's question in the same turn — chain the file reads then respond naturally.
</memory_on_start>`}

<knowledge_guidance>
You have a personal knowledge store at {knowledge}.
Use explore_knowledge to see what's available, then read_file to access specific items.
Knowledge includes: user preferences, usage patterns, plugin guides, contacts, and more.
Explore on-demand when the user's request suggests prior context would help.
Each knowledge file is max 200 lines. Use existing file tools to read and search within.
</knowledge_guidance>`;
        }

        if (includeEnv) {
            const tokens = await buildPathTokenMap({
                agentManager: this.agentManager,
                sessionWorkspace: this.agentManager?.sessionWorkspace || null,
                sessionId,
                agentId
            });
            const tokenLines = Object.keys(tokens)
                .map(token => `- ${token}`)
                .join('\n');
            prompt += `\n\n<path_tokens>
Use these portable path tokens in file tool calls instead of hard-coded absolute paths:
${tokenLines}
Tokens are resolved by the backend. Keep paths tokenized and forward-slashed in tool calls and outputs.
</path_tokens>`;
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
            prompt += await this._buildToolContext({
                completionToolNames: completionTools,
                sessionId,
                agentId
            });
        }

        return prompt;
    }

    async _buildToolContext({ completionToolNames = [], sessionId = null, agentId = null } = {}) {
        const scopeContext = { sessionId, agentId };
        const resolvedPermissions = this.mcpServer.toolPermissionService
            ? await this.mcpServer.toolPermissionService.resolveContext(scopeContext)
            : null;
        const activeTools = this.mcpServer.getActiveToolsForContext
            ? await this.mcpServer.getActiveToolsForContext(scopeContext)
            : (this.mcpServer.getActiveTools ? this.mcpServer.getActiveTools() : []);
        const visibleTools = activeTools.length > 0
            ? activeTools
            : (this.mcpServer.getToolsForContext
                ? await this.mcpServer.getToolsForContext(scopeContext)
                : this.mcpServer.getTools());
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
            const isActive = resolvedPermissions
                ? resolvedPermissions.toolStates?.[tool.name] === true
                : this.mcpServer.toolStates.get(tool.name) !== false;
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
        ctx += `Tool calls are parsed by backend syntax, not intent.\n`;
        ctx += `If you intend to call a tool, emit a valid TOOL line exactly. Do not describe the call in prose.\n`;
        ctx += `When calling tools, prefer outputting only TOOL lines (one per line), no markdown fences.\n`;
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
}

module.exports = InferenceDispatcher;
