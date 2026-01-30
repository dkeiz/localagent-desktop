/**
 * Tool Chain Controller
 * 
 * Manages multi-step tool execution with auto-continuation.
 * When LLM calls a tool and gets a result, this controller decides
 * whether to continue (if LLM just echoed the result) or stop.
 */

class ToolChainController {
    constructor(aiService, mcpServer, db) {
        this.aiService = aiService;
        this.mcpServer = mcpServer;
        this.db = db;
        this.maxChainSteps = 10; // Prevent infinite loops
        this.currentChain = []; // Track current tool chain for workflow learning
        this.stopped = false; // For aborting chains
    }

    /**
     * Stop the current chain
     */
    stopChain() {
        this.stopped = true;
        console.log('[Chain] Chain stopped by user');
    }

    /**
     * Execute a message with tool chaining support
     * @param {string} message - User message
     * @param {Array} conversationHistory - Previous conversation
     * @param {Object} options - Additional options
     * @returns {Object} Final response with chain info
     */
    async executeWithChaining(message, conversationHistory = [], options = {}) {
        this.currentChain = [];
        this.stopped = false; // Reset stopped flag for new chain
        let stepCount = 0;
        let currentMessage = message;
        let workingHistory = [...conversationHistory];
        let finalResponse = null;

        while (stepCount < this.maxChainSteps) {
            // Check if chain was stopped by user
            if (this.stopped) {
                console.log('[Chain] Chain stopped by user');
                break;
            }

            stepCount++;
            console.log(`[Chain] Step ${stepCount}: Processing message`);

            // Send message to LLM
            const response = await this.aiService.sendMessage(currentMessage, workingHistory, options);

            // Parse tool calls from response
            const toolCalls = this.mcpServer.parseToolCall(response.content);


            if (toolCalls.length === 0) {
                // No tool calls - this is the final answer
                finalResponse = response;
                break;
            }

            // Execute tool calls
            const toolResults = [];
            for (const call of toolCalls) {
                try {
                    const result = await this.mcpServer.executeTool(call.toolName, call.params);

                    // Check if it's the special end_answer tool
                    if (call.toolName === 'end_answer') {
                        finalResponse = {
                            content: result.answer || response.content,
                            model: response.model,
                            usage: response.usage,
                            chainComplete: true
                        };
                        break;
                    }

                    // Check for permission requirement
                    if (result && result.needsPermission) {
                        finalResponse = {
                            content: response.content,
                            model: response.model,
                            needsPermission: true,
                            permissionRequest: result
                        };
                        break;
                    }

                    toolResults.push({
                        tool: call.toolName,
                        params: call.params,
                        success: true,
                        result
                    });

                    // Add to current chain for workflow learning
                    this.currentChain.push({
                        tool: call.toolName,
                        params: call.params,
                        result
                    });

                } catch (error) {
                    toolResults.push({
                        tool: call.toolName,
                        params: call.params,
                        success: false,
                        error: error.message
                    });
                }
            }

            // If we got a final response (end_answer or permission needed), break
            if (finalResponse) break;

            // Build tool results context and continue
            const toolContext = toolResults.map(r =>
                r.success
                    ? `Tool "${r.tool}" result: ${JSON.stringify(r.result)}`
                    : `Tool "${r.tool}" error: ${r.error}`
            ).join('\n');

            // Add to history and continue
            workingHistory.push({ role: 'assistant', content: response.content });
            workingHistory.push({ role: 'user', content: `Tool execution results:\n${toolContext}\n\nBased on these results, either use another tool if needed, or provide the final answer to the user.` });

            currentMessage = ''; // Empty message, context is in history
        }

        // Add chain metadata to response
        if (finalResponse) {
            finalResponse.chain = {
                steps: stepCount,
                tools: this.currentChain.map(c => c.tool)
            };
        }

        return finalResponse;
    }

    /**
     * Check if LLM response is just echoing the tool result
     * @param {string} response - LLM response text
     * @param {*} toolResult - The tool result
     * @returns {boolean} True if response is mostly echoing the result
     */
    isEchoingResult(response, toolResult) {
        if (!toolResult) return false;

        const responseClean = response.toLowerCase().trim();
        const resultStr = typeof toolResult === 'string'
            ? toolResult.toLowerCase()
            : JSON.stringify(toolResult).toLowerCase();

        // Very short response (likely just repeating result)
        if (responseClean.length < 50) return true;

        // Response contains mostly the result
        if (resultStr.length > 10 && responseClean.includes(resultStr.substring(0, Math.min(50, resultStr.length)))) {
            // If response is only slightly longer than result, it's echoing
            if (responseClean.length < resultStr.length * 1.5) return true;
        }

        return false;
    }

    /**
     * Get the current tool chain (for workflow learning)
     */
    getCurrentChain() {
        return this.currentChain;
    }

    /**
     * Clear the current chain
     */
    clearChain() {
        this.currentChain = [];
    }
}

module.exports = ToolChainController;
