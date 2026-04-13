const fs = require('fs');
const path = require('path');
const SubtaskRuntime = require('./subtask-runtime');

/**
 * AgentManager — Manages agent lifecycle, folders, and session routing.
 * 
 * Agent types:
 *   pro  — persistent, skill-focused agents with memory + compact
 *   sub  — ephemeral agents called by others, return result then go blank
 */
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
        this.basePath = options.basePath || path.join(__dirname, '../../agentin/agents');
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

        // Seed predefined agents if none exist
        const existing = await this.db.getAgents();
        if (existing.length === 0) {
            await this._seedDefaultAgents();
        }

        // Ensure folders exist for all agents
        for (const agent of await this.db.getAgents()) {
            this._ensureAgentFolder(agent);
        }

        if (this.subtaskRuntime) {
            this.subtaskRuntime.initialize();
        }
    }

    async _seedDefaultAgents() {
        const defaults = [
            {
                name: 'Web Researcher',
                type: 'pro',
                icon: '🔍',
                description: 'Searches the web, fetches URLs, and summarizes findings',
                system_prompt: `You are a **Web Research Agent**. Your primary job is to search the web, fetch and parse URLs, and deliver concise, structured research reports.

## Behavior
- Use search_web_bing as your primary search tool for broad queries
- Use search_web_insta for quick factual lookups (definitions, entities)
- Use fetch_url to get full page content from promising results
- Use extract_text to convert fetched HTML to readable text
- Use search_fetched_text to find specific info in large pages
- Provide sources with every claim
- Structure findings with headers, bullet points, and key takeaways
- When asked to research a topic, be thorough — check multiple sources
- Save important findings to your memory for future reference

## Output Format
Start with a brief summary, then provide detailed findings organized by subtopic.`
            },
            {
                name: 'Code Reviewer',
                type: 'pro',
                icon: '🔬',
                description: 'Reviews code for bugs, security issues, and best practices',
                system_prompt: `You are a **Code Review Agent**. You specialize in reading, analyzing, and reviewing code.

## Behavior
- Use read_file and list_directory to explore codebases
- Look for: bugs, security vulnerabilities, performance issues, code smells
- Suggest concrete improvements with code examples
- Rate severity: 🔴 Critical, 🟡 Warning, 🟢 Suggestion
- Respect the existing code style and architecture

## Output Format
Organize findings by file, with severity ratings and actionable suggestions.`
            },
            {
                name: 'File Manager',
                type: 'pro',
                icon: '📂',
                description: 'Manages files, organizes directories, performs bulk operations',
                system_prompt: `You are a **File Management Agent**. You handle file operations, directory organization, and bulk file processing.

## Behavior
- Use file tools (read_file, write_file, list_directory, delete_file) for all operations
- Always confirm before destructive operations (delete, overwrite)
- Provide clear summaries of what was changed
- Can organize files by type, date, or custom criteria
- Use run_command for complex file operations when needed

## Output Format
Report actions taken with file paths and results.`
            },
            {
                name: 'System Monitor',
                type: 'pro',
                icon: '📊',
                description: 'Monitors system resources, runs diagnostics, checks health',
                system_prompt: `You are a **System Monitor Agent**. You check system health, resource usage, and run diagnostics.

## Behavior
- Use get_memory_usage, get_disk_space, run_command for system checks
- Proactively identify issues (low disk, high memory, etc.)
- Run common diagnostic commands for the user's OS
- Track system changes over time using your memory
- Provide clear, actionable recommendations

## Output Format
Dashboard-style reports with metrics, status indicators, and recommendations.`
            },
            {
                name: 'Search Agent',
                type: 'sub',
                icon: '🌐',
                description: 'Sub-agent: performs focused web searches and returns structured results',
                system_prompt: `You are a **Search Sub-Agent**. You receive a search task, execute it, and return structured results.

## Behavior
- Use search_web_bing for broad queries, search_web_insta for quick facts
- Use fetch_url to get full page content from promising results
- Use extract_text or search_fetched_text to process large pages
- Return a concise, structured summary of findings
- Always include source URLs
- Focus only on the specific task given — do not expand scope`
            }
        ];

        for (const agentDef of defaults) {
            try {
                await this.createAgent(agentDef);
            } catch (e) {
                console.error(`[AgentManager] Failed to seed agent "${agentDef.name}":`, e.message);
            }
        }

        console.log(`[AgentManager] Seeded ${defaults.length} default agents`);
    }

    _ensureAgentFolder(agent) {
        const folderPath = this._getAgentFolderPath(agent);
        const subDirs = agent.type === 'pro'
            ? ['memory', 'config']
            : ['temp'];

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
        const outputHint = expectedOutput && String(expectedOutput).trim()
            ? String(expectedOutput).trim()
            : 'Return the most useful structured fields for the task in the data object.';
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
If tool call is unavailable, return a strict JSON object (no wrappers, no markdown) matching the completion contract below.

Required completion contract:
- status: "${contractType}" on success, or "task_failed" on failure
- summary: short human-readable summary
- data: structured object with the actual result
- artifacts: array of files created or relied on for the result
- notes: optional string

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
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return 'Task completed';
        }
        const firstSentence = normalized.split(/[.!?]/)[0].trim();
        const summary = firstSentence || normalized;
        return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
    }

    _normalizeCompletionPayload(payload, contractType) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('Sub-agent completion payload must be an object');
        }

        const status = String(payload.status || '').trim();
        if (!status) {
            throw new Error('Sub-agent completion payload is missing status');
        }
        if (status !== contractType && status !== 'task_failed') {
            throw new Error(`Sub-agent returned invalid status "${status}" for contract "${contractType}"`);
        }

        const summary = String(payload.summary || '').trim();
        if (!summary) {
            throw new Error('Sub-agent completion payload is missing summary');
        }

        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
            ? payload.data
            : {};

        const artifacts = Array.isArray(payload.artifacts)
            ? payload.artifacts.map(artifact => {
                const normalizedPath = artifact?.path ? String(artifact.path) : '';
                const normalizedName = artifact?.name
                    ? String(artifact.name)
                    : (normalizedPath ? path.basename(normalizedPath) : '');

                return {
                    ...artifact,
                    path: normalizedPath,
                    name: normalizedName
                };
            })
            : [];

        return {
            status,
            summary,
            data,
            artifacts,
            notes: payload.notes ? String(payload.notes) : ''
        };
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

    async _completeSubagentRun(runId, response, sessionId, contractType) {
        let completionPayload = response?.completionResult
            ? response.completionResult
            : this._extractJsonObject(response?.content || '');

        if (!completionPayload && response?.content) {
            // Fallback for models that skip completion tool/JSON despite a valid textual result.
            completionPayload = {
                status: contractType,
                summary: this._summarizePlainText(response.content),
                data: {
                    output_text: String(response.content)
                },
                artifacts: [],
                notes: 'Auto-wrapped from plain-text subagent response because completion contract payload was missing.'
            };
        }

        const normalized = this._normalizeCompletionPayload(completionPayload, contractType);
        const workspaceArtifacts = this._normalizeWorkspaceArtifacts(sessionId);
        const artifacts = this._mergeArtifacts(normalized.artifacts, workspaceArtifacts);

        return {
            ...normalized,
            artifacts
        };
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

        return {
            onAssistantMessage: async ({ content }) => {
                this.subtaskRuntime.appendMessage(runId, {
                    role: 'assistant',
                    content
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

    async _executeDelegatedRun(run, agent, task, contractType, expectedOutput) {
        const traceHooks = this._createTraceHooks(run.run_id);
        const taskPrompt = this._buildSubAgentTask(task, contractType, expectedOutput, run);
        this.subtaskRuntime.appendMessage(run.run_id, {
            role: 'user',
            content: taskPrompt
        });

        this.subtaskRuntime.markRunning(run.run_id);
        this.eventBus?.publish('subagent:started', {
            runId: run.run_id,
            parentSessionId: run.parent_session_id,
            childSessionId: run.child_session_id,
            subagentId: run.subagent_id,
            agentName: run.agent_name,
            subagentMode: run.subagent_mode || 'no_ui'
        });

        try {
            const result = this.chainController
                ? await this.chainController.executeWithChaining(
                    taskPrompt,
                    [],
                    {
                        mode: 'chat',
                        sessionId: run.child_session_id,
                        agentId: agent.id,
                        includeTools: true,
                        includeRules: false,
                        completionTools: ['complete_subtask'],
                        trace: traceHooks
                    }
                )
                : await this.dispatcher.dispatch(
                    taskPrompt,
                    [],
                    {
                        mode: 'chat',
                        sessionId: run.child_session_id,
                        agentId: agent.id,
                        includeTools: true,
                        includeRules: false
                    }
                );

            if (!this.chainController && result?.content) {
                this.subtaskRuntime.appendMessage(run.run_id, {
                    role: 'assistant',
                    content: result.content
                });
            }

            const contract = await this._completeSubagentRun(run.run_id, result, run.child_session_id, contractType);
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
                deliveryPath: delivery?.delivery_path || null
            });

            return completedRun;
        } catch (error) {
            const failedRun = this.subtaskRuntime.failRun(run.run_id, error.message);
            await this.subtaskRuntime.deliverToParent(run.run_id, {
                status: 'failed',
                summary: error.message,
                contract: {
                    status: 'task_failed',
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
                error: error.message
            });
            return failedRun;
        } finally {
            await this._setSubagentActive(agent.id, false);
        }
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

        await this._setSubagentActive(subAgentId, true);
        this.eventBus?.publish('subagent:queued', {
            runId: run.run_id,
            parentSessionId,
            childSessionId: run.child_session_id,
            subagentId: subAgentId,
            agentName: agent.name,
            subagentMode
        });

        const pending = this._executeDelegatedRun(run, agent, task, contractType, expectedOutput)
            .catch(error => {
                console.error('[AgentManager] Delegated subtask failed:', error.message);
                return null;
            })
            .finally(() => {
                this.pendingSubtasks.delete(run.run_id);
            });
        this.pendingSubtasks.set(run.run_id, pending);

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
