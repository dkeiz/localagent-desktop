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
        const runtimeConfig = options.runtimeConfig || {};
        const reasoningConfig = runtimeConfig.reasoning || {};
        const reasoningCaps = options.modelSpec?.capabilities?.reasoning || {};

        // Apply a prompt hint only for models that do not expose a real reasoning parameter.
        const processedMessages = this._applyThinkingMode(messages, options.thinkingMode, reasoningCaps);

        const requestBody = {
            model: options.model || 'openrouter/auto',
            messages: processedMessages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 1000,
            stream: false
        };

        if (reasoningCaps.parameterMode === 'openrouter_reasoning' && reasoningCaps.supported) {
            requestBody.reasoning = {
                enabled: reasoningConfig.enabled,
                exclude: reasoningConfig.visibility === 'hide'
            };

            if (Array.isArray(reasoningCaps.effortLevels) && reasoningCaps.effortLevels.length > 0 && reasoningConfig.effort) {
                requestBody.reasoning.effort = reasoningConfig.effort;
            }

            if (reasoningCaps.maxTokens && reasoningConfig.maxTokens) {
                requestBody.reasoning.max_tokens = reasoningConfig.maxTokens;
            }
        }

        if (runtimeConfig.providerRouting?.requireParameters) {
            requestBody.provider = {
                require_parameters: true
            };
        }

        try {
            const response = await axios.post(`${this.baseURL}/chat/completions`, requestBody, {
                signal,
                headers
            });

            this._endRequest();

            const message = response.data.choices?.[0]?.message || {};
            const reasoning = this._extractReasoning(message, response.data);

            return this._normalizeResponse({
                content: message.content || '',
                reasoning,
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
        const apiKey = await this.db.getAPIKey('openrouter') || await this.db.getSetting('llm.openrouter.apiKey');
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
    _applyThinkingMode(messages, thinkingMode, reasoningCaps = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (reasoningCaps.parameterMode === 'openrouter_reasoning') return messages;

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

    _extractReasoning(message = {}, payload = {}) {
        if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
            return message.reasoning.trim();
        }

        if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
            return message.reasoning_content.trim();
        }

        if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
            return message.reasoning_details
                .map(detail => detail?.text || detail?.content || detail?.reasoning || '')
                .filter(Boolean)
                .join('\n')
                .trim();
        }

        if (typeof payload.reasoning_content === 'string' && payload.reasoning_content.trim()) {
            return payload.reasoning_content.trim();
        }

        if (typeof payload.reasoning === 'string' && payload.reasoning.trim()) {
            return payload.reasoning.trim();
        }

        const choiceReasoning = payload?.choices?.[0]?.reasoning;
        if (typeof choiceReasoning === 'string' && choiceReasoning.trim()) {
            return choiceReasoning.trim();
        }

        return '';
    }
}

module.exports = OpenRouterAdapter;
