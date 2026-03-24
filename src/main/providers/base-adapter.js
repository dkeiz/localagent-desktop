/**
 * BaseAdapter — Abstract base for all LLM provider adapters.
 *
 * Each provider extends this and implements:
 *   call(messages, options)  → { content, model, usage, stopped? }
 *   getModels()              → string[]
 *   stop()                   — abort running request
 */
class BaseAdapter {
    constructor(name, db) {
        this.name = name;
        this.db = db;
        this.abortController = null;
        this.isGenerating = false;
    }

    /**
     * Send messages to the LLM and get a response.
     * @param {Array} messages - [{role, content}, ...]
     * @param {Object} options - { model, temperature, max_tokens, thinkingMode, ... }
     * @returns {Object} { content, model, usage: { prompt_tokens, completion_tokens, total_tokens }, stopped? }
     */
    async call(messages, options = {}) {
        throw new Error(`${this.name}: call() not implemented`);
    }

    /**
     * Fetch available models from the provider.
     * @returns {string[]} model IDs/names
     */
    async getModels() {
        return [];
    }

    /**
     * Abort the current in-flight request.
     */
    stop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.isGenerating = false;
            console.log(`[${this.name}] Generation stopped`);
            return true;
        }
        return false;
    }

    /**
     * Create a fresh AbortController for a new request.
     */
    _startRequest() {
        this.abortController = new AbortController();
        this.isGenerating = true;
        return this.abortController.signal;
    }

    /**
     * Clean up after request completes.
     */
    _endRequest() {
        this.abortController = null;
        this.isGenerating = false;
    }

    /**
     * Normalize response to standard shape.
     */
    _normalizeResponse({ content, reasoning, model, usage, stopped = false, context_length }) {
        const result = {
            content: content || '',
            reasoning: reasoning || '',
            model: model || this.name,
            usage: {
                prompt_tokens: usage?.prompt_tokens || 0,
                completion_tokens: usage?.completion_tokens || 0,
                total_tokens: usage?.total_tokens || 0
            },
            stopped
        };
        if (context_length) result.context_length = context_length;
        return result;
    }
}

module.exports = BaseAdapter;
