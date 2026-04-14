const axios = require('axios');
const BaseAdapter = require('./base-adapter');

/**
 * OllamaAdapter — Ollama local + cloud model support.
 *
 * Uses /api/chat for inference, /api/tags for model listing.
 * Supports AbortController, context window (num_ctx), and thinking mode.
 */
class OllamaAdapter extends BaseAdapter {
    constructor(db) {
        super('ollama', db);
        this.baseURL = 'http://127.0.0.1:11434';
    }

    async call(messages, options = {}) {
        const signal = this._startRequest();
        const runtimeConfig = options.runtimeConfig || {};
        const contextLength = runtimeConfig.contextWindow?.value || options.modelSpec?.runtime?.contextWindow?.value || 8192;

        // Apply thinking mode if set
        const processedMessages = this._applyThinkingMode(
            messages,
            options.thinkingMode,
            options.modelSpec?.capabilities?.reasoning || {}
        );

        const requestBody = {
            model: options.model,
            messages: processedMessages,
            stream: false,
            options: {
                temperature: options.temperature || 0.7,
                top_p: options.top_p || 0.9,
                num_ctx: contextLength
            }
        };

        console.log(`[Ollama] model=${options.model} num_ctx=${contextLength}`);

        try {
            const response = await axios.post(`${this.baseURL}/api/chat`, requestBody, {
                signal
            });

            this._endRequest();

            return this._normalizeResponse({
                content: response.data.message.content,
                model: response.data.model,
                context_length: contextLength,
                usage: {
                    prompt_tokens: response.data.prompt_eval_count || 0,
                    completion_tokens: response.data.eval_count || 0,
                    total_tokens: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0)
                }
            });
        } catch (error) {
            this._endRequest();

            if (axios.isCancel(error) || error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
                return this._normalizeResponse({
                    content: '[Generation stopped by user]',
                    model: options.model,
                    stopped: true
                });
            }
            throw error;
        }
    }

    async getModels() {
        try {
            const response = await axios.get(`${this.baseURL}/api/tags`);
            return response.data.models.map(m => m.name);
        } catch (error) {
            console.error('[Ollama] Failed to fetch models:', error.message);
            return [];
        }
    }

    /**
     * Apply thinking mode for Qwen3/DeepSeek-style models.
     * Prepends /think or /nothink to the last user message.
     */
    _applyThinkingMode(messages, thinkingMode, reasoningCaps = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (!reasoningCaps.supported) return messages;

        const result = [...messages];
        // Find last user message and prepend the directive
        for (let i = result.length - 1; i >= 0; i--) {
            if (result[i].role === 'user') {
                const prefix = thinkingMode === 'think' ? '/think\n' : '/nothink\n';
                result[i] = { ...result[i], content: prefix + result[i].content };
                break;
            }
        }
        return result;
    }
}

module.exports = OllamaAdapter;
