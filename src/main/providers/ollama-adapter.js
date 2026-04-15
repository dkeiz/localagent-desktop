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
            options.modelSpec?.capabilities?.reasoning || {},
            runtimeConfig
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
            const message = response.data?.message || {};
            const content = this._coerceContent(message.content);
            const reasoning = this._coerceContent(
                message.reasoning_content
                || message.reasoning
                || message.thinking
                || response.data?.reasoning_content
                || response.data?.reasoning
                || response.data?.thinking
            );

            return this._normalizeResponse({
                content,
                reasoning,
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
    _applyThinkingMode(messages, thinkingMode, reasoningCaps = {}, runtimeConfig = {}) {
        if (!thinkingMode || thinkingMode === 'off') return messages;
        if (!reasoningCaps.supported) return messages;

        const result = [...messages];
        if (reasoningCaps.parameterMode === 'prompt_hint') {
            const effort = runtimeConfig?.reasoning?.effort;
            const effortText = effort ? ` Target reasoning effort: ${effort}.` : '';
            const hint = runtimeConfig?.reasoning?.visibility === 'hide'
                ? 'Reason internally if needed, but do not expose chain-of-thought in the final answer.'
                : (thinkingMode === 'think'
                    ? `Show concise reasoning before the final answer when the model supports it.${effortText}`
                    : 'Give the answer directly without exposed reasoning unless strictly required.');
            if (result.length > 0 && result[0].role === 'system') {
                result[0] = { ...result[0], content: `${result[0].content}\n\n${hint}` };
            } else {
                result.unshift({ role: 'system', content: hint });
            }
            return result;
        }

        // Default Ollama reasoning control uses slash directives.
        for (let i = result.length - 1; i >= 0; i--) {
            if (result[i].role === 'user') {
                const prefix = thinkingMode === 'think' ? '/think\n' : '/nothink\n';
                result[i] = { ...result[i], content: prefix + result[i].content };
                break;
            }
        }
        return result;
    }

    _coerceContent(value) {
        if (typeof value === 'string') return value;
        if (!Array.isArray(value)) return '';

        return value
            .map(part => {
                if (typeof part === 'string') return part;
                return part?.text || part?.content || part?.reasoning || '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
}

module.exports = OllamaAdapter;
