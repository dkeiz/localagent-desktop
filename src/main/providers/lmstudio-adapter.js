const axios = require('axios');
const BaseAdapter = require('./base-adapter');

/**
 * LMStudioAdapter — LM Studio local server (OpenAI-compatible API).
 *
 * Uses /v1/chat/completions for inference, /v1/models for listing.
 * Supports thinking mode via <think> tags.
 */
class LMStudioAdapter extends BaseAdapter {
    constructor(db) {
        super('lmstudio', db);
        this.baseURL = 'http://localhost:1234';
    }

    async call(messages, options = {}) {
        const signal = this._startRequest();

        // Load custom URL if saved
        const savedURL = await this.db.getSetting('llm.lmstudio.url');
        const url = savedURL || this.baseURL;

        // Apply thinking mode via system prompt hint
        const processedMessages = this._applyThinkingMode(
            messages,
            options.thinkingMode,
            options.runtimeConfig || {},
            options.modelSpec?.capabilities?.reasoning || {}
        );

        const requestBody = {
            model: options.model || '',
            messages: processedMessages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || -1,
            stream: false
        };

        try {
            const response = await axios.post(`${url}/v1/chat/completions`, requestBody, {
                signal,
                headers: await this._getHeaders()
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
            const savedURL = await this.db.getSetting('llm.lmstudio.url');
            const url = savedURL || this.baseURL;
            const response = await axios.get(`${url}/v1/models`);
            return response.data.data.map(m => m.id);
        } catch (error) {
            console.error('[LMStudio] Failed to fetch models:', error.message);
            return [];
        }
    }

    async _getHeaders() {
        const apiKey = await this.db.getSetting('llm.lmstudio.apiKey');
        const headers = {};
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    /**
     * LM Studio models with thinking support use <think> tags naturally.
     * We add a system hint to encourage or suppress reasoning.
     */
    _applyThinkingMode(messages, thinkingMode, runtimeConfig = {}, reasoningCaps = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (!reasoningCaps.supported) return messages;

        const result = [...messages];
        let hint;

        if (runtimeConfig.reasoning?.visibility === 'hide') {
            hint = 'Reason internally if needed, but do not expose chain-of-thought or thinking tags in the final answer.';
        } else {
            hint = thinkingMode === 'think'
                ? 'Show your reasoning step by step inside <think></think> tags before giving your final answer.'
                : 'Do not include any reasoning or thinking tags. Give your answer directly.';
        }

        // Append to system message if exists, or prepend new one
        if (result.length > 0 && result[0].role === 'system') {
            result[0] = { ...result[0], content: result[0].content + '\n\n' + hint };
        } else {
            result.unshift({ role: 'system', content: hint });
        }
        return result;
    }
}

module.exports = LMStudioAdapter;
