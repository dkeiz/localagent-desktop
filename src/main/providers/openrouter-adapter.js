const axios = require('axios');
const BaseAdapter = require('./base-adapter');

/**
 * OpenRouterAdapter — OpenRouter API (OpenAI-compatible).
 *
 * Uses /chat/completions for inference, /models for listing.
 * Requires API key.
 */
class OpenRouterAdapter extends BaseAdapter {
    constructor(db) {
        super('openrouter', db);
        this.baseURL = 'https://openrouter.ai/api/v1';
    }

    async call(messages, options = {}) {
        const signal = this._startRequest();
        const headers = await this._getHeaders();

        // Apply thinking mode
        const processedMessages = this._applyThinkingMode(messages, options.thinkingMode);

        const requestBody = {
            model: options.model || 'openrouter/auto',
            messages: processedMessages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 1000,
            stream: false
        };

        try {
            const response = await axios.post(`${this.baseURL}/chat/completions`, requestBody, {
                signal,
                headers
            });

            this._endRequest();

            return this._normalizeResponse({
                content: response.data.choices[0].message.content,
                model: response.data.model,
                usage: response.data.usage
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
            const headers = await this._getHeaders();
            const response = await axios.get(`${this.baseURL}/models`, { headers });
            return response.data.data.map(m => m.id);
        } catch (error) {
            console.error('[OpenRouter] Failed to fetch models:', error.message);
            return [];
        }
    }

    async _getHeaders() {
        const apiKey = await this.db.getSetting('llm.openrouter.apiKey') || await this.db.getAPIKey('openrouter');
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    /**
     * OpenRouter thinking mode — uses system prompt hints.
     * Some models behind OpenRouter support <think> tags natively.
     */
    _applyThinkingMode(messages, thinkingMode) {
        if (!thinkingMode || thinkingMode === 'off') return messages;

        const result = [...messages];
        const hint = thinkingMode === 'think'
            ? 'Show your reasoning step by step inside <think></think> tags before giving your final answer.'
            : 'Do not include any reasoning or thinking tags. Give your answer directly.';

        if (result.length > 0 && result[0].role === 'system') {
            result[0] = { ...result[0], content: result[0].content + '\n\n' + hint };
        } else {
            result.unshift({ role: 'system', content: hint });
        }
        return result;
    }
}

module.exports = OpenRouterAdapter;
