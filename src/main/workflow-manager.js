/**
 * Workflow Manager — File-First Architecture
 * 
 * Workflows live as JSON files in agentin/workflows/*.json (source of truth).
 * The database logs execution stats (success/failure counts, last_used).
 * On any read, files are synced to DB. On any write, a file is created first.
 */
const fs = require('fs');
const path = require('path');

class WorkflowManager {
    constructor(db, mcpServer) {
        this.db = db;
        this.mcpServer = mcpServer;
        this.workflowRuntime = null;
        this.workflowsDir = path.join(process.cwd(), 'agentin', 'workflows');
        this._ensureDir();
    }

    setWorkflowRuntime(runtime) {
        this.workflowRuntime = runtime;
    }

    _ensureDir() {
        if (!fs.existsSync(this.workflowsDir)) {
            fs.mkdirSync(this.workflowsDir, { recursive: true });
        }
    }

    /**
     * Generate a safe filename from a workflow name
     */
    _toFilename(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            + '.json';
    }

    /**
     * Scan agentin/workflows/*.json and sync to DB.
     * - New files → inserted into DB
     * - Existing files → updated if content changed
     * - DB entries without files → kept (auto-captured or visual-only workflows)
     */
    async syncFromFiles() {
        const files = fs.readdirSync(this.workflowsDir)
            .filter(f => f.endsWith('.json'));

        const dbWorkflows = await this.db.getWorkflows();
        const dbByName = new Map(dbWorkflows.map(w => [w.name, w]));

        let synced = 0;

        for (const file of files) {
            try {
                const filePath = path.join(this.workflowsDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const wf = JSON.parse(content);

                if (!wf.name || !wf.tool_chain) {
                    console.log(`[WorkflowManager] Skipping ${file}: missing name or tool_chain`);
                    continue;
                }

                const validation = this.validateToolChain(wf.tool_chain);
                if (!validation.valid) {
                    console.log(`[WorkflowManager] Skipping ${file}: invalid tools (${validation.invalidTools.join(', ')})`);
                    continue;
                }

                const existing = dbByName.get(wf.name);

                if (!existing) {
                    // New file → insert into DB
                    await this.db.addWorkflow({
                        name: wf.name,
                        description: wf.description || '',
                        trigger_pattern: wf.trigger_pattern || wf.name.toLowerCase(),
                        tool_chain: wf.tool_chain,
                        visual_data: wf.visual_data || null
                    });
                    synced++;
                    console.log(`[WorkflowManager] Synced new workflow from file: ${wf.name}`);
                } else {
                    // Existing → check if file content differs from DB
                    const dbChain = typeof existing.tool_chain === 'string'
                        ? existing.tool_chain
                        : JSON.stringify(existing.tool_chain);
                    const fileChain = JSON.stringify(wf.tool_chain);

                    if (dbChain !== fileChain || existing.description !== (wf.description || '')) {
                        this.db.run(
                            'UPDATE workflows SET description = ?, trigger_pattern = ?, tool_chain = ? WHERE id = ?',
                            [wf.description || '', wf.trigger_pattern || wf.name.toLowerCase(), fileChain, existing.id]
                        );
                        console.log(`[WorkflowManager] Updated workflow from file: ${wf.name}`);
                        synced++;
                    }
                }
            } catch (err) {
                console.error(`[WorkflowManager] Error reading ${file}:`, err.message);
            }
        }

        if (synced > 0) {
            console.log(`[WorkflowManager] Synced ${synced} workflows from files`);
        }
    }

    /**
     * Write a workflow to a JSON file
     */
    _writeFile(workflow) {
        const filename = this._toFilename(workflow.name);
        const filePath = path.join(this.workflowsDir, filename);
        const data = {
            name: workflow.name,
            description: workflow.description || '',
            trigger_pattern: workflow.trigger_pattern || workflow.name.toLowerCase(),
            tool_chain: Array.isArray(workflow.tool_chain) ? workflow.tool_chain : JSON.parse(workflow.tool_chain)
        };
        if (workflow.visual_data) {
            data.visual_data = typeof workflow.visual_data === 'string'
                ? JSON.parse(workflow.visual_data)
                : workflow.visual_data;
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`[WorkflowManager] Wrote file: ${filename}`);
        return filePath;
    }

    /**
     * Delete the JSON file for a workflow
     */
    _deleteFile(name) {
        const filename = this._toFilename(name);
        const filePath = path.join(this.workflowsDir, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[WorkflowManager] Deleted file: ${filename}`);
        }
    }

    /**
     * Get all workflows — syncs from files first, then returns from DB
     */
    async getWorkflows() {
        await this.syncFromFiles();
        const workflows = await this.db.getWorkflows();
        return workflows.map(w => ({
            ...w,
            tool_chain: typeof w.tool_chain === 'string' ? JSON.parse(w.tool_chain) : w.tool_chain,
            embedding: w.embedding ? JSON.parse(w.embedding) : null
        }));
    }

    /**
     * Capture a successful tool chain as a workflow (writes file + DB)
     */
    async captureWorkflow(trigger, toolChain, name = null) {
        if (!toolChain || toolChain.length === 0) {
            throw new Error('Cannot capture empty tool chain');
        }

        const validation = this.validateToolChain(toolChain);
        if (!validation.valid) {
            throw new Error(`Workflow includes unknown tools: ${validation.invalidTools.join(', ')}`);
        }

        const workflowName = name || this.generateWorkflowName(toolChain);
        const cleanChain = toolChain.map(step => ({
            tool: step.tool,
            params: step.params
        }));

        const description = `Workflow using: ${cleanChain.map(s => s.tool).join(' → ')}`;
        const workflow = {
            name: workflowName,
            description,
            trigger_pattern: this.extractTriggerPattern(trigger),
            tool_chain: cleanChain
        };

        // Write file first, then DB
        this._writeFile(workflow);
        console.log(`[WorkflowManager] Capturing workflow: ${workflowName}`);
        return await this.db.addWorkflow(workflow);
    }

    /**
     * Execute a saved workflow
     */
    async executeWorkflow(workflowId, paramOverrides = {}) {
        const execution = await this.executeWorkflowSteps(workflowId, paramOverrides);
        return {
            workflow: execution.workflow.name,
            success: execution.success,
            results: execution.results
        };
    }

    async executeWorkflowSteps(workflowId, paramOverrides = {}, options = {}) {
        const workflow = await this.getWorkflowByIdWithChain(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        const validation = this.validateToolChain(workflow.tool_chain);
        if (!validation.valid) {
            throw new Error(`Workflow "${workflow.name}" contains unknown tools: ${validation.invalidTools.join(', ')}`);
        }

        const results = [];
        let success = true;
        console.log(`[WorkflowManager] Executing workflow: ${workflow.name}`);

        for (const step of workflow.tool_chain) {
            try {
                const params = { ...step.params, ...(paramOverrides[step.tool] || {}) };
                const result = await this.mcpServer.executeTool(step.tool, params);

                if (result && result.needsPermission) {
                    success = false;
                    const stepResult = { tool: step.tool, success: false, needsPermission: true, error: 'Permission required' };
                    results.push(stepResult);
                    if (typeof options.onStep === 'function') {
                        await options.onStep({ ...stepResult });
                    }
                    break;
                }

                const stepResult = { tool: step.tool, success: true, result };
                results.push(stepResult);
                if (typeof options.onStep === 'function') {
                    await options.onStep({ ...stepResult });
                }
            } catch (error) {
                success = false;
                const stepResult = { tool: step.tool, success: false, error: error.message };
                results.push(stepResult);
                if (typeof options.onStep === 'function') {
                    await options.onStep({ ...stepResult });
                }
                break;
            }
        }

        await this.db.updateWorkflowStats(workflowId, success);
        return { workflow, success, results };
    }

    resolveRunMode(toolChain, mode = 'auto') {
        const requested = String(mode || 'auto').toLowerCase();
        if (requested === 'sync' || requested === 'async') {
            return requested;
        }

        const chain = Array.isArray(toolChain) ? toolChain : [];
        const asyncHintTools = new Set([
            'run_subagent',
            'run_command',
            'run_python',
            'fetch_url',
            'download_file'
        ]);
        if (chain.length >= 3) {
            return 'async';
        }
        if (chain.some(step => asyncHintTools.has(step.tool))) {
            return 'async';
        }
        return 'sync';
    }

    async runWorkflow(workflowId, options = {}) {
        const mode = options.mode || 'auto';
        const paramOverrides = options.paramOverrides || {};
        const requestedBySessionId = options.requestedBySessionId || null;

        if (!this.workflowRuntime) {
            const result = await this.executeWorkflow(workflowId, paramOverrides);
            return {
                accepted: true,
                immediate: true,
                status: result.success ? 'completed' : 'failed',
                mode: this.resolveRunMode([], mode),
                result
            };
        }

        return this.workflowRuntime.startRun({
            workflowId,
            mode,
            paramOverrides,
            requestedBySessionId
        });
    }

    async getWorkflowRun(runId) {
        if (!this.workflowRuntime) {
            return null;
        }
        return this.workflowRuntime.getRun(runId);
    }

    async listWorkflowRuns(filters = {}) {
        if (!this.workflowRuntime) {
            return [];
        }
        return this.workflowRuntime.listRuns(filters);
    }

    async waitForWorkflowRun(runId, timeoutMs = 30000) {
        if (!this.workflowRuntime) {
            return null;
        }
        return this.workflowRuntime.waitForRun(runId, timeoutMs);
    }

    /**
     * Find workflows matching a user query
     */
    async findMatchingWorkflows(query) {
        await this.syncFromFiles();
        const workflows = await this.db.getWorkflows();
        const queryLower = query.toLowerCase();

        return workflows.filter(w => {
            const triggerMatch = w.trigger_pattern && w.trigger_pattern.toLowerCase().includes(queryLower);
            const nameMatch = w.name.toLowerCase().includes(queryLower);
            const descMatch = w.description && w.description.toLowerCase().includes(queryLower);
            return triggerMatch || nameMatch || descMatch;
        });
    }

    /**
     * Delete a workflow (removes file + DB entry)
     */
    async deleteWorkflow(id) {
        const workflow = await this.db.getWorkflowById(id);
        if (workflow) {
            this._deleteFile(workflow.name);
        }
        return await this.db.deleteWorkflow(id);
    }

    /**
     * Copy/clone a workflow (writes new file + DB entry)
     */
    async copyWorkflow(id, newName = null) {
        const source = await this.db.getWorkflowById(id);
        if (!source) {
            throw new Error(`Workflow not found: ${id}`);
        }

        const toolChain = typeof source.tool_chain === 'string'
            ? JSON.parse(source.tool_chain)
            : source.tool_chain;

        const visualData = source.visual_data
            ? (typeof source.visual_data === 'string' ? JSON.parse(source.visual_data) : source.visual_data)
            : null;

        const copy = {
            name: newName || `${source.name} (copy)`,
            description: source.description,
            trigger_pattern: source.trigger_pattern,
            tool_chain: toolChain,
            visual_data: visualData
        };

        // Write file first, then DB
        this._writeFile(copy);
        console.log(`[WorkflowManager] Copying workflow "${source.name}" → "${copy.name}"`);
        return await this.db.addWorkflow(copy);
    }

    /**
     * Update an existing workflow (updates file + DB)
     */
    async updateWorkflow(id, data) {
        const workflow = await this.db.getWorkflowById(id);
        if (!workflow) {
            throw new Error(`Workflow not found: ${id}`);
        }

        // If name changed, delete old file
        if (data.name && data.name !== workflow.name) {
            this._deleteFile(workflow.name);
        }

        const updates = {};
        if (data.name !== undefined) updates.name = data.name;
        if (data.description !== undefined) updates.description = data.description;
        if (data.trigger_pattern !== undefined) updates.trigger_pattern = data.trigger_pattern;
        if (data.tool_chain !== undefined) {
            const validation = this.validateToolChain(data.tool_chain);
            if (!validation.valid) {
                throw new Error(`Workflow includes unknown tools: ${validation.invalidTools.join(', ')}`);
            }
            updates.tool_chain = JSON.stringify(data.tool_chain);
        }
        if (data.visual_data !== undefined) updates.visual_data = JSON.stringify(data.visual_data);

        if (Object.keys(updates).length === 0) return workflow;

        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updates), id];
        this.db.run(`UPDATE workflows SET ${setClauses} WHERE id = ?`, values);

        // Write updated file
        const updated = await this.db.getWorkflowById(id);
        this._writeFile(updated);

        console.log(`[WorkflowManager] Updated workflow ${id}`);
        return updated;
    }

    generateWorkflowName(toolChain) {
        const tools = toolChain.map(s => s.tool);
        const timestamp = Date.now();
        return `${tools[0]}_chain_${timestamp}`;
    }

    extractTriggerPattern(trigger) {
        const words = trigger.toLowerCase().split(/\s+/).slice(0, 5);
        return words.join(' ');
    }

    async getWorkflowByIdWithChain(id) {
        const workflow = await this.db.getWorkflowById(id);
        if (!workflow) return null;
        return {
            ...workflow,
            tool_chain: typeof workflow.tool_chain === 'string'
                ? JSON.parse(workflow.tool_chain)
                : (workflow.tool_chain || [])
        };
    }

    validateToolChain(toolChain) {
        if (!Array.isArray(toolChain) || toolChain.length === 0) {
            return { valid: false, invalidTools: ['<empty>'] };
        }

        const toolDefs = this.mcpServer?.getTools?.();
        if (!Array.isArray(toolDefs) || toolDefs.length === 0) {
            return { valid: true, invalidTools: [] };
        }
        const available = new Set(toolDefs.map(tool => tool.name));
        const invalidTools = toolChain
            .map(step => String(step?.tool || '').trim())
            .filter(name => !name || !available.has(name));

        return {
            valid: invalidTools.length === 0,
            invalidTools: Array.from(new Set(invalidTools))
        };
    }
}

module.exports = WorkflowManager;
