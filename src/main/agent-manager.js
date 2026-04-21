const fs = require('fs');
const path = require('path');
const { getDefaultAgents } = require('./agent-defaults');
const { enableCompanionPlugin, disableCompanionPlugin } = require('./agent-companion-plugins');
const { invokeMultipleSubAgents } = require('./agent-batch-invoker');
const SubtaskRuntime = require('./subtask-runtime');
const {
    assessCompletionQuality,
    buildCompletionCandidate,
    buildForcedIncompleteContract,
    buildSubagentIdentifiers,
    buildSubagentReminderPrompt,
    normalizeCompletionPayload,
    summarizePlainText
} = require('./subagent-contract');

class AgentManager {
    constructor(db, dispatcher, agentLoop, agentMemory, sessionWorkspace = null, chainController = null, eventBus = null, subtaskRuntime = null, options = {}) {
        this.db = db;
        this.dispatcher = dispatcher;
        this.agentLoop = agentLoop;
        this.agentMemory = agentMemory;
        this.sessionWorkspace = sessionWorkspace;
        this.chainController = chainController;
        this.eventBus = eventBus;
        this.subtaskRuntime = subtaskRuntime || new SubtaskRuntime(db, sessionWorkspace, eventBus);
        this.pendingSubtasks = new Map();
        this.activeSubtaskCounts = new Map();
        this.providerSubtaskQueues = new Map();
        this.cancelledSubtaskRuns = new Set();
        this.pluginManager = options.pluginManager || null;
        this.toolPermissionService = options.toolPermissionService || null;
        this.basePath = options.basePath || path.join(__dirname, '../../agentin/agents');
        this.maxDelegatedCompletionRetries = Math.max(0, Number(options.maxDelegatedCompletionRetries) || 2);
    }

    setPluginManager(pluginManager) {
        this.pluginManager = pluginManager;
    }

    setToolPermissionService(toolPermissionService) {
        this.toolPermissionService = toolPermissionService || null;
    }

    async initialize() {
        // Ensure folder structure
        const dirs = [
            this.basePath,
            path.join(this.basePath, 'pro'),
            path.join(this.basePath, 'sub')
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // Seed any missing predefined agents
        await this._seedDefaultAgents(await this.db.getAgents());

        // Ensure folders exist for all agents
        for (const agent of await this.db.getAgents()) {
            this._ensureAgentFolder(agent);
        }

        if (this.subtaskRuntime) {
            this.subtaskRuntime.initialize();
        }
    }

    async _seedDefaultAgents(existingAgents = null) {
        const defaults = getDefaultAgents();
        const existingNames = new Set((existingAgents || await this.db.getAgents())
            .map(agent => String(agent.name || '').toLowerCase()));
        let created = 0;

        for (const agentDef of defaults) {
            if (existingNames.has(String(agentDef.name).toLowerCase())) {
                continue;
            }
            try {
                await this.createAgent(agentDef);
                created++;
            } catch (e) {
                console.error(`[AgentManager] Failed to seed agent "${agentDef.name}":`, e.message);
            }
        }

        if (created > 0) {
            console.log(`[AgentManager] Seeded ${created} default agent(s)`);
        }
    }

    _ensureAgentFolder(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const subDirs = agent.type === 'pro'
            ? ['memory', 'config', 'tasks', 'outputs']
            : ['temp', 'tasks', 'outputs'];

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        for (const sub of subDirs) {
            const subPath = path.join(folderPath, sub);
            if (!fs.existsSync(subPath)) {
                fs.mkdirSync(subPath, { recursive: true });
            }
        }

        // Write system.md if it doesn't exist
        const systemFile = path.join(folderPath, 'system.md');
        if (!fs.existsSync(systemFile) && agent.system_prompt) {
            fs.writeFileSync(systemFile, agent.system_prompt, 'utf-8');
        }
    }

    _getAgentFolderPath(agent) {
        const safeName = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
        return path.join(this.basePath, agent.type, safeName);
    }

    _getSafeFolderName(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    }

    // ── CRUD ──

    async createAgent({ name, type = 'pro', icon = '🤖', system_prompt, description, config }) {
        const folderName = this._getSafeFolderName(name);
        const folderPath = `${type}/${folderName}`;

        const agent = await this.db.addAgent({
            name, type, icon, system_prompt, description, config, folder_path: folderPath
        });

        this._ensureAgentFolder({ ...agent, type, name });

        return agent;
    }

    async updateAgent(id, data) {
        const result = await this.db.updateAgent(id, data);

        // If system_prompt changed, sync to file
        if (data.system_prompt) {
            const agent = await this.db.getAgent(id);
            if (agent) {
                const folderPath = this._getAgentFolderPath(agent);
                const systemFile = path.join(folderPath, 'system.md');
                fs.writeFileSync(systemFile, data.system_prompt, 'utf-8');
            }
        }

        return result;
    }

    async deleteAgent(id) {
        const agent = await this.db.getAgent(id);
        if (agent) {
            // Remove folder (optional — keep data for safety)
            // const folderPath = this._getAgentFolderPath(agent);
            // if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true });
        }
        return await this.db.deleteAgent(id);
    }

    async getAgents(type = null) {
        return await this.db.getAgents(type);
    }

    async getAgent(id) {
        return await this.db.getAgent(id);
    }

    // ── Lifecycle ──

    async activateAgent(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);

        // Set status to active
        await this.db.updateAgent(agentId, { status: 'active' });

        // Find or create a session for this agent
        let session = await this.db.getAgentSession(agentId);
        if (!session) {
            session = await this.db.createAgentSession(agentId);
        }

        // Auto-enable companion plugin if exists
        await this._enableCompanionPlugin(agent);

        return { agent, sessionId: session.id };
    }

    async deactivateAgent(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent) return;

        // Trigger compact if pro agent with enough history
        if (agent.type === 'pro') {
            try {
                await this.compactAgent(agentId);
            } catch (e) {
                console.error(`[AgentManager] Compact failed for agent ${agentId}:`, e.message);
            }
        }

        // Auto-disable companion plugin if exists
        await this._disableCompanionPlugin(agent);

        await this.db.updateAgent(agentId, { status: 'idle' });
    }

    async compactAgent(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent || agent.type !== 'pro') return;

        const session = await this.db.getAgentSession(agentId);
        if (!session) return;

        // Get recent conversations
        const messages = await this.db.getConversations(100, session.id);
        if (messages.length < 4) return; // Not enough to summarize

        // Build summary via internal dispatch
        const historyText = messages
            .map(m => `${m.role}: ${m.content}`)
            .slice(-20)  // Last 20 messages
            .join('\n');

        try {
            const result = await this.dispatcher.dispatch(
                `Summarize this conversation concisely. Focus on key decisions, findings, and action items:\n\n${historyText}`,
                [],
                { mode: 'internal', includeTools: false, includeRules: false }
            );

            // Save compact summary to agent's memory folder
            const folderPath = this._getAgentFolderPath(agent);
            const compactFile = path.join(folderPath, 'memory', 'compact.md');
            const timestamp = new Date().toISOString();
            const entry = `\n\n---\n[${timestamp}] Session Compact\n${result.content}\n`;

            fs.appendFileSync(compactFile, entry);
            console.log(`[AgentManager] Compacted agent "${agent.name}" to ${compactFile}`);
        } catch (e) {
            console.error(`[AgentManager] Compact dispatch failed:`, e.message);
        }
    }

    /**
     * Get the system prompt for an agent, loading from file if available.
     * Falls back to DB system_prompt field.
     */
    getAgentSystemPrompt(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const systemFile = path.join(folderPath, 'system.md');

        try {
            if (fs.existsSync(systemFile)) {
                return fs.readFileSync(systemFile, 'utf-8');
            }
        } catch (e) {
            console.error(`[AgentManager] Failed to read agent system.md:`, e.message);
        }

        return agent.system_prompt || '';
    }

    /**
     * Get compact memory for an agent (if exists).
     */
    getAgentMemory(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const compactFile = path.join(folderPath, 'memory', 'compact.md');

        try {
            if (fs.existsSync(compactFile)) {
                return fs.readFileSync(compactFile, 'utf-8');
            }
        } catch (e) {
            // No compact memory yet
        }

        return null;
    }

    _buildSubAgentTask(task, contractType, expectedOutput = '', run = null) {
        const outputHint = expectedOutput && String(expectedOutput).trim() ? String(expectedOutput).trim() : 'Return the most useful structured fields for the task in the data object.';
        const runGuidance = run
            ? `Run files for this delegated task:
- Run Folder: ${run.run_dir}
- Status File: ${run.status_path}
- Result File: ${run.result_path}
- Trace File: ${run.trace_path}
- Workspace Directory: ${run.workspace_dir}

Your parent may inspect this run folder later if clarification is needed. Keep your work legible, and use workspace files for large intermediate output when useful.
`
            : '';

        return `You are being invoked as a sub-agent by another agent.

Complete only the requested task. Use available tools if needed.
When the completion tool "complete_subtask" is available, call it to finish the run.
If tool call is unavailable, return a strict JSON object (no wrappers, no markdown) matching the completion envelope below.
Silent stop is invalid. If the result is empty, blocked, or unavailable, deliver that noticed outcome instead of stopping.

Required completion envelope:
- status: short outcome label. "${contractType}" is preferred for a strong result, but labels like "partial", "empty", "blocked", or "task_failed" are valid too
- summary: short human-readable outcome
- data: structured object with the actual result or outcome details
- artifacts: array of files created or relied on for the result
- notes: optional string

The parent is authoritative. It may accept your envelope, recall you, or send a new task based on what you deliver.

Expected output details:
${outputHint}

${runGuidance}

Task:
${task}`;
    }

    _extractJsonObject(text) {
        const content = String(text || '').trim();
        if (!content) return null;

        const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i) || content.match(/```\s*([\s\S]*?)```/i);
        const candidate = fencedMatch ? fencedMatch[1].trim() : content;

        try {
            return JSON.parse(candidate);
        } catch (error) {
            // Fall through to brace-depth extraction.
        }

        const start = candidate.indexOf('{');
        if (start === -1) {
            return null;
        }

        let depth = 0;
        let inString = false;
        let escapeNext = false;

        for (let index = start; index < candidate.length; index++) {
            const char = candidate[index];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (inString) {
                continue;
            }

            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(candidate.slice(start, index + 1));
                    } catch (error) {
                        return null;
                    }
                }
            }
        }

        return null;
    }

    _summarizePlainText(text) {
        return summarizePlainText(text);
    }

    _normalizeWorkspaceArtifacts(sessionId) {
        if (!this.sessionWorkspace) {
            return [];
        }

        return this.sessionWorkspace.listFiles(sessionId).map(file => ({
            path: file.path,
            name: file.name,
            size: file.size,
            created: file.created instanceof Date ? file.created.toISOString() : file.created,
            description: 'Generated in sub-agent workspace',
            source: 'workspace'
        }));
    }

    _mergeArtifacts(contractArtifacts, workspaceArtifacts) {
        const merged = new Map();

        const pushArtifact = (artifact, fallbackSource) => {
            if (!artifact || typeof artifact !== 'object') {
                return;
            }

            const pathValue = artifact.path ? String(artifact.path) : '';
            const nameValue = artifact.name ? String(artifact.name) : '';
            const key = nameValue || pathValue;
            if (!key) {
                return;
            }

            const existing = merged.get(key) || {};
            merged.set(key, {
                ...existing,
                ...artifact,
                path: pathValue || existing.path || '',
                name: nameValue || existing.name || '',
                source: artifact.source || existing.source || fallbackSource
            });
        };

        contractArtifacts.forEach(artifact => pushArtifact(artifact, 'contract'));
        workspaceArtifacts.forEach(artifact => pushArtifact(artifact, 'workspace'));

        return Array.from(merged.values());
    }

    async _persistSubagentConversation(sessionId, role, content, metadata = null) {
        if (!this.db || typeof this.db.addConversation !== 'function' || !sessionId || !content) {
            return;
        }

        try {
            await this.db.addConversation({ role, content, metadata }, sessionId);
        } catch (error) {
            console.error('[AgentManager] Failed to persist subagent conversation:', error.message);
        }
    }

    _resolveSubagentCompletion(response, sessionId, contractType) {
        const candidate = buildCompletionCandidate(
            response,
            contractType,
            (text) => this._extractJsonObject(text)
        );
        if (!candidate.payload) {
            return {
                ok: false,
                retryable: true,
                reason: 'missing_completion_contract',
                message: candidate.source === 'missing'
                    ? 'Sub-agent completion payload missing; expected complete_subtask call or strict JSON result.'
                    : 'Sub-agent returned plain text instead of the required completion envelope.',
                candidate
            };
        }

        const payload = {
            ...candidate.payload,
            status: candidate.payload.status || candidate.inferredStatus,
            summary: candidate.payload.summary
                || summarizePlainText(candidate.rawContent || JSON.stringify(candidate.payload.data || {})),
            data: candidate.payload.data && typeof candidate.payload.data === 'object' && !Array.isArray(candidate.payload.data)
                ? candidate.payload.data
                : {},
            artifacts: Array.isArray(candidate.payload.artifacts) ? candidate.payload.artifacts : [],
            notes: candidate.payload.notes === undefined || candidate.payload.notes === null
                ? ''
                : candidate.payload.notes
        };

        let normalized;
        try {
            normalized = normalizeCompletionPayload(payload, { preferredStatus: contractType });
        } catch (error) {
            return {
                ok: false,
                retryable: true,
                reason: 'invalid_completion_contract',
                message: error.message,
                candidate
            };
        }

        const workspaceArtifacts = this._normalizeWorkspaceArtifacts(sessionId);
        const contract = {
            ...normalized,
            artifacts: this._mergeArtifacts(normalized.artifacts, workspaceArtifacts)
        };
        const quality = assessCompletionQuality(contract, candidate);
        if (!quality.ok) {
            return {
                ok: false,
                retryable: true,
                reason: quality.reason,
                message: quality.message,
                candidate,
                contract
            };
        }

        return {
            ok: true,
            retryable: false,
            candidate,
            contract
        };
    }

    async _loadSubagentConversationHistory(sessionId) {
        if (!this.db || typeof this.db.getConversations !== 'function') {
            return [];
        }

        const messages = await this.db.getConversations(100, sessionId);
        return (Array.isArray(messages) ? messages : [])
            .map(message => ({
                role: message.role,
                content: String(message.content || '')
            }))
            .filter(message => message.content.trim().length > 0);
    }

    async _persistDelegatedPrompt(runId, sessionId, content, metadata = {}) {
        this.subtaskRuntime.appendMessage(runId, {
            role: 'user',
            content,
            metadata
        });
        await this._persistSubagentConversation(sessionId, 'user', content, metadata);
    }

    async _setSubagentActive(agentId, active) {
        const current = this.activeSubtaskCounts.get(agentId) || 0;
        const next = active ? current + 1 : Math.max(0, current - 1);
        this.activeSubtaskCounts.set(agentId, next);
        await this.db.updateAgent(agentId, { status: next > 0 ? 'active' : 'idle' });
    }

    _createTraceHooks(runId) {
        if (!this.subtaskRuntime) {
            return null;
        }

        const run = this.subtaskRuntime.getRun(runId);
        const sessionId = run?.child_session_id || null;

        return {
            onAssistantMessage: async ({ content }) => {
                const visibleContent = this.chainController?.stripToolPatterns
                    ? this.chainController.stripToolPatterns(content)
                    : String(content || '').trim();
                if (!visibleContent) {
                    return;
                }
                this.subtaskRuntime.appendMessage(runId, {
                    role: 'assistant',
                    content: visibleContent
                });
                await this._persistSubagentConversation(sessionId, 'assistant', visibleContent);
            },
            onSyntheticUserMessage: async ({ content, kind }) => {
                this.subtaskRuntime.appendMessage(runId, {
                    role: 'user',
                    content,
                    metadata: {
                        auto_generated: true,
                        kind: kind || 'synthetic_user'
                    }
                });
                await this._persistSubagentConversation(sessionId, 'user', content, {
                    auto_generated: true,
                    kind: kind || 'synthetic_user'
                });
            },
            onToolResult: async ({ toolName, params, success, result, error }) => {
                this.subtaskRuntime.appendToolEvent(runId, {
                    tool_name: toolName,
                    params,
                    success,
                    result,
                    error
                });
                const label = success
                    ? `Tool ${toolName} succeeded:\n${JSON.stringify(result, null, 2)}`
                    : `Tool ${toolName} failed: ${error || 'Unknown error'}`;
                await this._persistSubagentConversation(sessionId, 'system', label, {
                    tool_name: toolName,
                    params,
                    success
                });
            }
        };
    }

    async getSubagentRun(runId) {
        if (this.subtaskRuntime) {
            return this.subtaskRuntime.getRun(runId);
        }
        return this.db.getSubagentRun(runId);
    }

    async listSubagentRuns(filters = {}) {
        if (this.subtaskRuntime) {
            return this.subtaskRuntime.listRuns(filters);
        }
        return this.db.listSubagentRuns(filters);
    }

    async waitForSubagentRun(runId, timeoutMs = 30000) {
        const timeout = Math.max(100, Number(timeoutMs) || 30000);
        const started = Date.now();

        while (Date.now() - started < timeout) {
            const pending = this.pendingSubtasks.get(runId);
            if (pending) {
                await Promise.race([
                    pending.catch(() => null),
                    new Promise(resolve => setTimeout(resolve, 25))
                ]);
            }

            const run = await this.getSubagentRun(runId);
            if (run && ['failed', 'task_failed'].includes(String(run.status))) {
                if (pending) {
                    await pending.catch(() => null);
                }
                return run;
            }
            if (run && run.result) {
                if (pending) {
                    await pending.catch(() => null);
                    return this.getSubagentRun(runId);
                }
                return run;
            }

            await new Promise(resolve => setTimeout(resolve, 25));
        }

        throw new Error(`Timed out waiting for subagent run ${runId}`);
    }

    _isSubagentRunCancelled(runId) {
        return this.cancelledSubtaskRuns.has(String(runId));
    }

    _consumeCancelledSubagentRun(runId) {
        this.cancelledSubtaskRuns.delete(String(runId));
    }

    _assertSubagentRunNotCancelled(runId) {
        if (this._isSubagentRunCancelled(runId)) {
            throw new Error('Cancelled by user');
        }
    }

    _isCancellationError(error) {
        return String(error?.message || '').toLowerCase().includes('cancelled by user');
    }

    async _executeDelegatedRun(run, agent, task, contractType, expectedOutput) {
        this._assertSubagentRunNotCancelled(run.run_id);
        const traceHooks = this._createTraceHooks(run.run_id);
        const taskPrompt = this._buildSubAgentTask(task, contractType, expectedOutput, run);
        await this._persistDelegatedPrompt(run.run_id, run.child_session_id, taskPrompt, {
            delegated: true,
            parent_session_id: run.parent_session_id,
            run_id: run.run_id,
            subagent_id: run.subagent_id
        });

        this.subtaskRuntime.markRunning(run.run_id);
        const identifiers = buildSubagentIdentifiers(run);
        this.eventBus?.publish('subagent:started', {
            runId: run.run_id,
            parentSessionId: run.parent_session_id,
            childSessionId: run.child_session_id,
            subagentId: run.subagent_id,
            agentName: run.agent_name,
            subagentMode: run.subagent_mode || 'no_ui',
            identifiers
        });

        try {
            let prompt = taskPrompt;
            let history = [];
            let result = null;
            let validation = null;
            let remindersSent = 0;

            while (true) {
                this._assertSubagentRunNotCancelled(run.run_id);
                result = this.chainController
                    ? await this.chainController.executeWithChaining(
                        prompt,
                        history,
                        {
                            mode: 'chat',
                            sessionId: run.child_session_id,
                            agentId: agent.id,
                            subagentRunId: run.run_id,
                            includeTools: true,
                            includeRules: false,
                            skipMemoryOnStart: true,
                            skipLock: true,
                            completionTools: ['complete_subtask'],
                            maxChainSteps: 24,
                            trace: traceHooks
                        }
                    )
                    : await this.dispatcher.dispatch(
                        prompt,
                        history,
                        {
                            mode: 'chat',
                            sessionId: run.child_session_id,
                            agentId: agent.id,
                            includeTools: true,
                            includeRules: false,
                            skipMemoryOnStart: true,
                            skipLock: true
                        }
                    );
                this._assertSubagentRunNotCancelled(run.run_id);

                if (!this.chainController && result?.content) {
                    this.subtaskRuntime.appendMessage(run.run_id, {
                        role: 'assistant',
                        content: result.content
                    });
                }

                validation = this._resolveSubagentCompletion(result, run.child_session_id, contractType);
                if (validation.ok) {
                    break;
                }

                if (remindersSent >= this.maxDelegatedCompletionRetries) {
                    validation = {
                        ok: true,
                        contract: buildForcedIncompleteContract(
                            contractType,
                            validation,
                            remindersSent,
                            result
                        )
                    };
                    break;
                }

                remindersSent += 1;
                history = await this._loadSubagentConversationHistory(run.child_session_id);
                prompt = buildSubagentReminderPrompt(contractType, validation, remindersSent);
                await this._persistDelegatedPrompt(run.run_id, run.child_session_id, prompt, {
                    delegated: true,
                    auto_generated: true,
                    kind: 'backend_completion_reminder',
                    reminder_attempt: remindersSent,
                    run_id: run.run_id,
                    subagent_id: run.subagent_id
                });
            }

            const contract = validation.contract;
            const completedRun = this.subtaskRuntime.completeRun(run.run_id, {
                contract,
                artifacts: contract.artifacts,
                raw_response: result?.content || ''
            });
            const delivery = await this.subtaskRuntime.deliverToParent(run.run_id, {
                status: contract.status,
                summary: contract.summary,
                contract
            });

            this.eventBus?.publish('subagent:completed', {
                runId: run.run_id,
                parentSessionId: run.parent_session_id,
                childSessionId: run.child_session_id,
                subagentId: run.subagent_id,
                agentName: run.agent_name,
                subagentMode: run.subagent_mode || 'no_ui',
                summary: contract.summary,
                status: contract.status,
                deliveryPath: delivery?.delivery_path || null,
                identifiers
            });

            return completedRun;
        } catch (error) {
            if (this._isCancellationError(error) && this.subtaskRuntime?.cancelRun) {
                const stoppedRun = this.subtaskRuntime.cancelRun(run.run_id, 'Stopped by user');
                this.eventBus?.publish('subagent:failed', {
                    runId: run.run_id,
                    parentSessionId: run.parent_session_id,
                    childSessionId: run.child_session_id,
                    subagentId: run.subagent_id,
                    agentName: run.agent_name,
                    subagentMode: run.subagent_mode || 'no_ui',
                    error: 'Stopped by user',
                    status: 'stopped',
                    cancelled: true,
                    identifiers
                });
                return stoppedRun;
            }

            const failedRun = this.subtaskRuntime.failRun(run.run_id, error.message);
            await this.subtaskRuntime.deliverToParent(run.run_id, {
                status: 'failed',
                summary: error.message,
                contract: {
                    status: 'delivery_error',
                    summary: error.message,
                    data: {},
                    artifacts: [],
                    notes: ''
                }
            });
            this.eventBus?.publish('subagent:failed', {
                runId: run.run_id,
                parentSessionId: run.parent_session_id,
                childSessionId: run.child_session_id,
                subagentId: run.subagent_id,
                agentName: run.agent_name,
                subagentMode: run.subagent_mode || 'no_ui',
                error: error.message,
                identifiers
            });
            return failedRun;
        } finally {
            if (this.toolPermissionService) {
                this.toolPermissionService.clearRunScopedGrant(run.run_id);
            }
            this._consumeCancelledSubagentRun(run.run_id);
            await this._setSubagentActive(agent.id, false);
        }
    }

    async cancelSubagentRun(runId, reason = 'Cancelled by user') {
        const normalizedRunId = String(runId || '').trim();
        if (!normalizedRunId) {
            return { success: false, error: 'runId is required' };
        }

        const run = await this.getSubagentRun(normalizedRunId);
        if (!run) {
            return { success: false, error: `Subagent run "${normalizedRunId}" not found` };
        }

        const status = String(run.status || '');
        if (['failed', 'completed', 'task_complete', 'task_failed', 'cancelled', 'stopped'].includes(status)) {
            return { success: true, run };
        }

        this.cancelledSubtaskRuns.add(normalizedRunId);
        if (this.subtaskRuntime && typeof this.subtaskRuntime.cancelRun === 'function') {
            this.subtaskRuntime.cancelRun(normalizedRunId, String(reason || 'Stopped by user'));
        }

        this.eventBus?.publish('subagent:failed', {
            runId: run.run_id,
            parentSessionId: run.parent_session_id,
            childSessionId: run.child_session_id,
            subagentId: run.subagent_id,
            agentName: run.agent_name,
            subagentMode: run.subagent_mode || 'no_ui',
            error: String(reason || 'Stopped by user'),
            status: 'stopped',
            cancelled: true,
            identifiers: buildSubagentIdentifiers(run)
        });

        return { success: true, run: await this.getSubagentRun(normalizedRunId) };
    }

    _startDelegatedRun(run, agent, task, contractType, expectedOutput, queueProvider = null) {
        const execute = () => this._executeDelegatedRun(run, agent, task, contractType, expectedOutput)
            .catch(error => {
                console.error('[AgentManager] Delegated subtask failed:', error.message);
                return null;
            });
        let pending;

        if (queueProvider) {
            const previous = this.providerSubtaskQueues.get(queueProvider) || Promise.resolve();
            const queued = previous.catch(() => null).then(execute);
            const providerPending = queued.finally(() => {
                if (this.providerSubtaskQueues.get(queueProvider) === providerPending) {
                    this.providerSubtaskQueues.delete(queueProvider);
                }
            });
            pending = providerPending;
            this.providerSubtaskQueues.set(queueProvider, pending);
        } else {
            pending = execute();
        }

        pending = pending.finally(() => {
            this.pendingSubtasks.delete(run.run_id);
        });
        this.pendingSubtasks.set(run.run_id, pending);
        return pending;
    }

    // ── Sub-Agent Invocation ──

    async invokeSubAgent(parentSessionId, subAgentId, task, options = {}) {
        const agent = await this.db.getAgent(subAgentId);
        if (!agent || agent.type !== 'sub') {
            throw new Error(`Sub-agent ${subAgentId} not found or not a sub-agent`);
        }

        const contractType = options.contractType || 'task_complete';
        const expectedOutput = options.expectedOutput || '';
        const subagentModeRaw = String(options.subagentMode || 'no_ui').trim().toLowerCase();
        const subagentMode = subagentModeRaw === 'ui' ? 'ui' : 'no_ui';
        const run = this.subtaskRuntime.createRun({
            parentSessionId,
            subagentId: subAgentId,
            agentName: agent.name,
            task,
            contractType,
            expectedOutput,
            subagentMode
        });

        if (this.toolPermissionService && options.permissionsContract) {
            this.toolPermissionService.setRunScopedGrant(run.run_id, subAgentId, options.permissionsContract);
        }

        await this._setSubagentActive(subAgentId, true);
        const identifiers = buildSubagentIdentifiers({
            ...run,
            parent_session_id: parentSessionId,
            subagent_id: subAgentId
        });
        this.eventBus?.publish('subagent:queued', {
            runId: run.run_id,
            parentSessionId,
            childSessionId: run.child_session_id,
            subagentId: subAgentId,
            agentName: agent.name,
            subagentMode,
            identifiers
        });

        this._startDelegatedRun(run, agent, task, contractType, expectedOutput, options.queueProvider || null);

        return {
            accepted: true,
            success: true,
            runId: run.run_id,
            run_id: run.run_id,
            agentId: subAgentId,
            agentName: agent.name,
            childSessionId: run.child_session_id,
            child_session_id: run.child_session_id,
            parentSessionId,
            parent_session_id: parentSessionId,
            contractType,
            contract_type: contractType,
            subagentMode,
            subagent_mode: subagentMode,
            status: run.status,
            identifiers,
            runDir: run.run_dir,
            run_dir: run.run_dir,
            resultPath: run.result_path,
            result_path: run.result_path,
            tracePath: run.trace_path,
            trace_path: run.trace_path,
            workspaceDir: run.workspace_dir,
            workspace_dir: run.workspace_dir
        };
    }

    // ── Companion Plugin Auto-Enable/Disable ──

    async _enableCompanionPlugin(agent) {
        return enableCompanionPlugin(this, agent);
    }

    async _disableCompanionPlugin(agent) {
        return disableCompanionPlugin(this, agent);
    }

    // ── Agent Folder Path for External Access ──

    getAgentFolderPathById(agentId) {
        // Synchronous lookup via cached agents — used by MCP context
        return null; // Will be resolved async via getAgent
    }

    async resolveAgentFolder(agentId) {
        const agent = await this.db.getAgent(agentId);
        if (!agent) return null;
        return this._getAgentFolderPath(agent);
    }

    // ── Batch Subagent Invocation ──

    async invokeMultipleSubAgents(parentSessionId, tasks, options = {}) {
        return invokeMultipleSubAgents(this, parentSessionId, tasks, options);
    }

    // ── Cleanup ──

    async onAppQuit() {
        // Deactivate all active agents
        const agents = await this.db.getAgents();
        for (const agent of agents) {
            if (agent.status === 'active') {
                await this.deactivateAgent(agent.id);
            }
        }
    }
}

module.exports = AgentManager;
