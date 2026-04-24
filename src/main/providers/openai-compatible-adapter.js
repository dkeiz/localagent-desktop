const axios = require('axios');
const BaseAdapter = require('./base-adapter');

const RESERVED_OVERRIDE_KEYS = new Set(['model', 'messages', 'stream']);

class OpenAICompatibleAdapter extends BaseAdapter {
    constructor(providerId, db, options = {}) {
        super(providerId, db);
        this.providerId = providerId;
        this.providerLabel = options.label || providerId;
        this.defaultBaseURL = options.defaultBaseURL || '';
        this.apiPrefix = options.apiPrefix || '';
        this.apiKeyOptional = options.apiKeyOptional === true;
        this.defaultHeaders = options.defaultHeaders || {};
    }

    async call(messages, options = {}) {
        const signal = this._startRequest();
        const runtimeConfig = options.runtimeConfig || {};
        const reasoningCaps = options.modelSpec?.capabilities?.reasoning || {};
        const processedMessages = this._applyThinkingMode(
            messages,
            options.thinkingMode,
            runtimeConfig,
            reasoningCaps
        );

        const requestBody = {
            model: options.model || '',
            messages: processedMessages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 1000,
            stream: false
        };

        this._applyReasoningConfig(requestBody, runtimeConfig, reasoningCaps);
        this._applyRequestOverrides(requestBody, runtimeConfig.requestOverrides);

        try {
            const response = await axios.post(
                this._buildEndpoint(await this._getBaseURL(), '/chat/completions'),
                requestBody,
                {
                    signal,
                    headers: await this._getHeaders()
                }
            );

            this._endRequest();

            const message = response.data?.choices?.[0]?.message || {};
            return this._normalizeResponse({
                content: this._coerceContent(message.content),
                reasoning: this._extractReasoning(message, response.data),
                model: response.data?.model || options.model || this.providerId,
                usage: response.data?.usage,
                context_length: runtimeConfig.contextWindow?.value || options.modelSpec?.runtime?.contextWindow?.value
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
            const response = await axios.get(
                this._buildEndpoint(await this._getBaseURL(), '/models'),
                { headers: await this._getHeaders() }
            );
            return this._extractModelIds(response.data);
        } catch (error) {
            console.error(`[${this.providerLabel}] Failed to fetch models:`, error.message);
            return [];
        }
    }

    async _getBaseURL() {
        const stored = await this.db.getSetting(`llm.${this.providerId}.url`);
        return this._normalizeBaseURL(stored || this.defaultBaseURL);
    }

    async _getHeaders() {
        const apiKey = await this.db.getAPIKey(this.providerId) || await this.db.getSetting(`llm.${this.providerId}.apiKey`);
        if (!apiKey && !this.apiKeyOptional) {
            throw new Error(`${this.providerLabel} API key not configured`);
        }

        const headers = {
            'Content-Type': 'application/json',
            ...this.defaultHeaders
        };

        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }

        return headers;
    }

    _normalizeBaseURL(url) {
        return String(url || '').trim().replace(/\/+$/, '');
    }

    _buildEndpoint(baseURL, pathName) {
        const normalizedBase = this._normalizeBaseURL(baseURL);
        if (!normalizedBase) {
            throw new Error(`${this.providerLabel} base URL is not configured`);
        }

        if (!this.apiPrefix) {
            return `${normalizedBase}${pathName}`;
        }

        if (normalizedBase.toLowerCase().endsWith(this.apiPrefix.toLowerCase())) {
            return `${normalizedBase}${pathName}`;
        }

        return `${normalizedBase}${this.apiPrefix}${pathName}`;
    }

    _applyThinkingMode(messages, thinkingMode, runtimeConfig = {}, reasoningCaps = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (!reasoningCaps.supported) return messages;
        if (reasoningCaps.parameterMode === 'openai_reasoning_effort') return messages;

        const result = [...messages];
        let hint;

        if (runtimeConfig.reasoning?.visibility === 'hide') {
            hint = 'Reason internally if needed, but do not reveal chain-of-thought or thinking tags in the final answer.';
        } else {
            hint = thinkingMode === 'think'
                ? 'Show concise reasoning before the final answer when the model supports it.'
                : 'Give the answer directly without exposed reasoning unless it is strictly required.';
        }

        if (result.length > 0 && result[0].role === 'system') {
            result[0] = { ...result[0], content: `${result[0].content}\n\n${hint}` };
        } else {
            result.unshift({ role: 'system', content: hint });
        }

        return result;
    }

    _applyReasoningConfig(requestBody, runtimeConfig = {}, reasoningCaps = {}) {
        if (!reasoningCaps.supported) return;
        if (reasoningCaps.parameterMode !== 'openai_reasoning_effort') return;

        const levels = Array.isArray(reasoningCaps.effortLevels) ? reasoningCaps.effortLevels : [];
        if (levels.length === 0) return;

        const desired = runtimeConfig.reasoning?.enabled
            ? runtimeConfig.reasoning?.effort
            : (levels.includes('minimal') ? 'minimal' : levels[0]);

        requestBody.reasoning_effort = levels.includes(desired) ? desired : levels[0];
    }

    _applyRequestOverrides(requestBody, requestOverrides) {
        if (!requestOverrides || typeof requestOverrides !== 'object' || Array.isArray(requestOverrides)) {
            return;
        }

        for (const [key, value] of Object.entries(requestOverrides)) {
            if (RESERVED_OVERRIDE_KEYS.has(key)) continue;
            requestBody[key] = value;
        }
    }

    _extractModelIds(payload = {}) {
        const raw = Array.isArray(payload?.data)
            ? payload.data
            : (Array.isArray(payload?.models) ? payload.models : []);

        return Array.from(new Set(raw
            .map(entry => {
                if (typeof entry === 'string') return entry;
                return entry?.id || entry?.name || entry?.model;
            })
            .filter(Boolean)
            .map(String)));
    }

    _extractReasoning(message = {}, payload = {}) {
        if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
            return message.reasoning.trim();
        }

        if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
            return message.reasoning_content.trim();
        }

        if (Array.isArray(message.content)) {
            const contentReasoning = message.content
                .map(part => {
                    if (!part || typeof part !== 'object') return '';
                    if (part.type === 'reasoning') {
                        return part.reasoning || part.text || part.content || '';
                    }
                    return '';
                })
                .filter(Boolean)
                .join('\n')
                .trim();
            if (contentReasoning) {
                return contentReasoning;
            }
        }

        const choiceReasoning = payload?.choices?.[0]?.reasoning;
        if (typeof choiceReasoning === 'string' && choiceReasoning.trim()) {
            return choiceReasoning.trim();
        }

        if (typeof payload.reasoning_content === 'string' && payload.reasoning_content.trim()) {
            return payload.reasoning_content.trim();
        }

        if (typeof payload.reasoning === 'string' && payload.reasoning.trim()) {
            return payload.reasoning.trim();
        }

        if (Array.isArray(payload.output)) {
            const outputReasoning = payload.output
                .map(item => {
                    if (!item || typeof item !== 'object') return '';
                    if (item.type === 'reasoning') {
                        return item.summary || item.text || item.content || item.reasoning || '';
                    }
                    return item.reasoning || item.reasoning_content || '';
                })
                .filter(Boolean)
                .join('\n')
                .trim();
            if (outputReasoning) {
                return outputReasoning;
            }
        }

        return '';
    }

    _coerceContent(value) {
        if (typeof value === 'string') return value;
        if (!Array.isArray(value)) return '';

        return value
            .map(part => {
                if (typeof part === 'string') return part;
                return part?.text || part?.content || '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
}

module.exports = OpenAICompatibleAdapter;
