/**
 * Workflow Manager
 * 
 * Captures successful tool chains as reusable workflows.
 * Manages workflow storage, retrieval, and execution.
 */

class WorkflowManager {
    constructor(db, mcpServer) {
        this.db = db;
        this.mcpServer = mcpServer;
    }

    /**
     * Capture a successful tool chain as a workflow
     * @param {string} trigger - The user message that triggered this chain
     * @param {Array} toolChain - Array of tool calls with params and results
     * @param {string} [name] - Optional workflow name
     * @returns {Object} Created workflow
     */
    async captureWorkflow(trigger, toolChain, name = null) {
        if (!toolChain || toolChain.length === 0) {
            throw new Error('Cannot capture empty tool chain');
        }

        // Generate a name if not provided
        const workflowName = name || this.generateWorkflowName(toolChain);

        // Extract tool sequence for storage (remove results for cleaner storage)
        const cleanChain = toolChain.map(step => ({
            tool: step.tool,
            params: step.params
        }));

        // Create description from the tools used
        const description = `Workflow using: ${cleanChain.map(s => s.tool).join(' → ')}`;

        const workflow = {
            name: workflowName,
            description,
            trigger_pattern: this.extractTriggerPattern(trigger),
            tool_chain: cleanChain
        };

        console.log(`[WorkflowManager] Capturing workflow: ${workflowName}`);
        return await this.db.addWorkflow(workflow);
    }

    /**
     * Execute a saved workflow
     * @param {number} workflowId - ID of the workflow to execute
     * @param {Object} [paramOverrides] - Optional parameter overrides for tools
     * @returns {Object} Execution result
     */
    async executeWorkflow(workflowId, paramOverrides = {}) {
        const workflow = await this.db.getWorkflowById(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        const toolChain = JSON.parse(workflow.tool_chain);
        const results = [];
        let success = true;

        console.log(`[WorkflowManager] Executing workflow: ${workflow.name}`);

        for (const step of toolChain) {
            try {
                // Apply any parameter overrides
                const params = { ...step.params, ...(paramOverrides[step.tool] || {}) };

                const result = await this.mcpServer.executeTool(step.tool, params);

                // Check for permission requirement
                if (result && result.needsPermission) {
                    success = false;
                    results.push({
                        tool: step.tool,
                        success: false,
                        needsPermission: true,
                        error: 'Permission required'
                    });
                    break;
                }

                results.push({
                    tool: step.tool,
                    success: true,
                    result
                });
            } catch (error) {
                success = false;
                results.push({
                    tool: step.tool,
                    success: false,
                    error: error.message
                });
                break;
            }
        }

        // Update workflow stats
        await this.db.updateWorkflowStats(workflowId, success);

        return {
            workflow: workflow.name,
            success,
            results
        };
    }

    /**
     * Find workflows matching a user query
     * @param {string} query - User query to match against
     * @returns {Array} Matching workflows
     */
    async findMatchingWorkflows(query) {
        // Simple keyword matching - will be enhanced with vector search in Phase 4
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
     * Generate a workflow name from the tool chain
     */
    generateWorkflowName(toolChain) {
        const tools = toolChain.map(s => s.tool);
        const timestamp = Date.now();
        return `${tools[0]}_chain_${timestamp}`;
    }

    /**
     * Extract key patterns from a trigger message
     */
    extractTriggerPattern(trigger) {
        // Simple extraction - get first few words as pattern
        const words = trigger.toLowerCase().split(/\s+/).slice(0, 5);
        return words.join(' ');
    }

    /**
     * Get all workflows
     */
    async getWorkflows() {
        const workflows = await this.db.getWorkflows();
        return workflows.map(w => ({
            ...w,
            tool_chain: JSON.parse(w.tool_chain),
            embedding: w.embedding ? JSON.parse(w.embedding) : null
        }));
    }

    /**
     * Delete a workflow
     */
    async deleteWorkflow(id) {
        return await this.db.deleteWorkflow(id);
    }
}

module.exports = WorkflowManager;
