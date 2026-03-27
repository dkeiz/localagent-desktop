const fs = require('fs');
const path = require('path');

/**
 * AgentManager — Manages agent lifecycle, folders, and session routing.
 * 
 * Agent types:
 *   pro  — persistent, skill-focused agents with memory + compact
 *   sub  — ephemeral agents called by others, return result then go blank
 */
class AgentManager {
    constructor(db, dispatcher, agentLoop, agentMemory) {
        this.db = db;
        this.dispatcher = dispatcher;
        this.agentLoop = agentLoop;
        this.agentMemory = agentMemory;
        this.basePath = path.join(__dirname, '../../agentin/agents');
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

    // ── Sub-Agent Invocation ──

    async invokeSubAgent(parentSessionId, subAgentId, task) {
        const agent = await this.db.getAgent(subAgentId);
        if (!agent || agent.type !== 'sub') {
            throw new Error(`Sub-agent ${subAgentId} not found or not a sub-agent`);
        }

        // Create temporary session
        const session = await this.db.createAgentSession(subAgentId, `Sub: ${agent.name}`);

        try {
            // Build agent-specific system prompt
            const systemPrompt = this.getAgentSystemPrompt(agent);

            // Dispatch task
            const result = await this.dispatcher.dispatch(
                task,
                [],
                {
                    mode: 'chat',
                    sessionId: session.id,
                    agentId: subAgentId,
                    includeTools: true,
                    includeRules: false
                }
            );

            return {
                success: true,
                agentName: agent.name,
                result: result.content,
                sessionId: session.id
            };
        } catch (e) {
            return {
                success: false,
                agentName: agent.name,
                error: e.message
            };
        }
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
