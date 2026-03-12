/**
 * Tool Chain Controller
 * 
 * Manages multi-step tool execution with auto-continuation.
 * When LLM calls a tool and gets a result, this controller decides
 * whether to continue (if LLM just echoed the result) or stop.
 */

class ToolChainController {
    constructor(dispatcher, mcpServer, db) {
        this.dispatcher = dispatcher;
        this.mcpServer = mcpServer;
        this.db = db;
        this.maxChainSteps = 10; // Prevent infinite loops
        this.currentChain = []; // Track current tool chain for workflow learning
        this.stopped = false; // For aborting chains
        this.workflowManager = null; // Set via setWorkflowManager()
        this.autoCapture = false; // Toggle via setAutoCapture()
    }

    /**
     * Set the workflow manager for auto-capture
     */
    setWorkflowManager(wm) {
        this.workflowManager = wm;
    }

    /**
     * Toggle auto-capture of successful tool chains as workflows
     */
    setAutoCapture(enabled) {
        this.autoCapture = enabled;
        console.log(`[Chain] Auto-capture ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Stop the current chain
     */
    stopChain() {
        this.stopped = true;
        console.log('[Chain] Chain stopped by user');
    }

    /**
     * Strip TOOL: patterns from text (brace-depth aware)
     */
    stripToolPatterns(text) {
        if (!text) return text;
        return text.replace(/TOOL:\w+\{/g, (match, offset) => {
            // Find matching closing brace with nesting
            const startIdx = offset + match.length - 1; // position of opening {
            let depth = 1;
            let i = startIdx + 1;
            let inString = false;
            let escapeNext = false;

            while (i < text.length && depth > 0) {
                const char = text[i];
                if (escapeNext) { escapeNext = false; i++; continue; }
                if (char === '\\') { escapeNext = true; i++; continue; }
                if (char === '"' && !escapeNext) { inString = !inString; i++; continue; }
                if (!inString) {
                    if (char === '{') depth++;
                    else if (char === '}') depth--;
                }
                i++;
            }
            // Return empty string to remove the entire TOOL:name{...} pattern
            return '\x00'.repeat(i - offset); // placeholder
        }).replace(/\x00+/g, '').trim();
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
        this.executedToolCalls = new Map(); // Track executed tool calls by ID
        let stepCount = 0;
        let currentMessage = message;
        let originalUserMessage = message; // Keep reference to user's actual question
        let workingHistory = [...conversationHistory];
        let finalResponse = null;
        let lastLLMResponse = null; // Track last response for fallback

        while (stepCount < this.maxChainSteps) {
            // Check if chain was stopped by user
            if (this.stopped) {
                console.log('[Chain] Chain stopped by user');
                break;
            }

            stepCount++;
            console.log(`[Chain] Step ${stepCount}: Processing message`);

            // Send message to LLM via dispatcher (mode=chat includes tools + rules)
            // On continuation steps, currentMessage is null — tool results are in workingHistory
            const response = await this.dispatcher.dispatch(currentMessage, workingHistory, { mode: 'chat', sessionId: options.sessionId, agentId: options.agentId });
            lastLLMResponse = response;

            // Parse tool calls from response
            const toolCalls = this.mcpServer.parseToolCall(response.content);

            if (toolCalls.length === 0) {
                // No tool calls - this is the final answer
                // Clean any leftover TOOL: patterns from content
                finalResponse = {
                    ...response,
                    content: this.stripToolPatterns(response.content) || response.content
                };
                break;
            }

            // Execute tool calls
            const toolResults = [];
            for (const call of toolCalls) {
                try {
                    // Check for duplicate tool call
                    const dedupeKey = `${call.toolName}:${JSON.stringify(call.params)}`;
                    const alreadyExecuted = Array.from(this.executedToolCalls.values())
                        .some(prev => `${prev.toolName}:${JSON.stringify(prev.params)}` === dedupeKey);
                    if (alreadyExecuted) {
                        console.log(`[Chain] Skipping duplicate tool call: ${call.toolName}`);
                        toolResults.push({
                            toolCallId: call.toolCallId,
                            tool: call.toolName,
                            params: call.params,
                            success: true,
                            result: '[Duplicate call skipped — already executed with same parameters]'
                        });
                        continue;
                    }

                    // Pass tool call ID to executeTool
                    const result = await this.mcpServer.executeTool(
                        call.toolName,
                        call.params,
                        call.toolCallId  // Pass the unique ID
                    );

                    // Check if it's the special end_answer tool
                    if (call.toolName === 'end_answer') {
                        finalResponse = {
                            content: result.result?.answer || this.stripToolPatterns(response.content) || response.content,
                            model: response.model,
                            usage: response.usage,
                            chainComplete: true
                        };
                        break;
                    }

                    // Check for permission requirement
                    if (result && result.needsPermission) {
                        // Return the LLM's text (stripped of TOOL: calls) with permission info
                        finalResponse = {
                            content: this.stripToolPatterns(response.content) || response.content,
                            model: response.model,
                            needsPermission: true,
                            permissionRequest: result
                        };
                        break;
                    }

                    // Track this execution
                    this.executedToolCalls.set(call.toolCallId, {
                        toolName: call.toolName,
                        params: call.params,
                        result: result.result,
                        timestamp: result.timestamp
                    });

                    toolResults.push({
                        toolCallId: call.toolCallId,  // Include unique ID
                        tool: call.toolName,
                        params: call.params,
                        timestamp: result.timestamp,  // Include timestamp
                        success: true,
                        result: result.result  // Unwrap the actual result
                    });

                    // Add to current chain for workflow learning
                    this.currentChain.push({
                        tool: call.toolName,
                        params: call.params,
                        result: result.result
                    });

                } catch (error) {
                    toolResults.push({
                        toolCallId: call.toolCallId,
                        tool: call.toolName,
                        params: call.params,
                        success: false,
                        error: error.message
                    });
                }
            }

            // If we got a final response (end_answer or permission needed), break
            if (finalResponse) break;

            // Build tool results context with tracking metadata
            const toolContext = toolResults.map(r => {
                if (r.success) {
                    return `[Tool Call ID: ${r.toolCallId}]
Tool: "${r.tool}"
Timestamp: ${r.timestamp}
Result: ${JSON.stringify(r.result)}

✓ This tool was successfully executed. Do NOT call it again with the same parameters.`;
                } else {
                    return `[Tool Call ID: ${r.toolCallId}]
Tool: "${r.tool}"
Error: ${r.error}`;
                }
            }).join('\n\n---\n\n');

            // Add LLM's response (with tool calls) to history as assistant turn
            workingHistory.push({ role: 'assistant', content: response.content });
            // Add tool results as a structured block — use <tool_results> tags
            // so the model can distinguish them from real user messages.
            // Include original question so model doesn't lose track.
            workingHistory.push({
                role: 'user',
                content: `<tool_results>\n${toolContext}\n</tool_results>\n\n<original_user_question>${originalUserMessage}</original_user_question>\nThe tool results above were auto-generated by the backend. Based on these results, provide a natural, helpful answer to the original user question shown above. Do NOT call these same tools again.`
            });

            // CRITICAL FIX: Set to null so sendMessage doesn't add another empty user message
            currentMessage = null;
        }

        // Handle case where loop ended without finalResponse (maxSteps exceeded)
        if (!finalResponse && lastLLMResponse) {
            console.log('[Chain] Max steps reached, using last response');
            finalResponse = {
                ...lastLLMResponse,
                content: this.stripToolPatterns(lastLLMResponse.content) || 'I ran into an issue processing your request. Please try again.',
                chainExhausted: true
            };
        }

        // Safety: ensure we always return something
        if (!finalResponse) {
            finalResponse = {
                content: 'Sorry, I was unable to process your request. Please try again.',
                model: 'unknown',
                usage: { total_tokens: 0 }
            };
        }

        // Add chain metadata to response
        finalResponse.chain = {
            steps: stepCount,
            tools: this.currentChain.map(c => c.tool)
        };

        // Auto-capture successful chains as workflows (2+ unique tools)
        if (this.autoCapture && this.workflowManager && this.currentChain.length >= 2 && !finalResponse.chainExhausted) {
            try {
                const originalMsg = options._originalMessage || message || '';
                await this.workflowManager.captureWorkflow(originalMsg, this.currentChain);
                console.log(`[Chain] Auto-captured workflow from ${this.currentChain.length}-step chain`);
            } catch (err) {
                console.error('[Chain] Auto-capture failed:', err.message);
            }
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
