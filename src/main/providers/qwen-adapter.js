const axios = require('axios');
const BaseAdapter = require('./base-adapter');

/**
 * QwenAdapter — Qwen/DashScope API + CLI mode.
 *
 * Supports two modes:
 *   - api: DashScope REST API with API key
 *   - cli: local qwen CLI command
 *
 * Thinking mode uses /think or /nothink prefix (Qwen3 native).
 */
class QwenAdapter extends BaseAdapter {
    constructor(db) {
        super('qwen', db);
        this.baseURL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

        // Model cache with TTL
        this.modelCache = {
            models: [],
            lastSuccess: 0
        };
    }

    async call(messages, options = {}) {
        const mode = await this.db.getSetting('llm.qwen.mode') || 'cli';

        if (mode === 'cli') {
            return this._callCLI(messages, options);
        } else {
            return this._callAPI(messages, options);
        }
    }

    async _callAPI(messages, options) {
        const signal = this._startRequest();
        const apiKey = await this.db.getSetting('llm.qwen.apiKey');
        if (!apiKey) throw new Error('Qwen API key not configured');

        // Apply thinking mode
        const processedMessages = this._applyThinkingMode(messages, options.thinkingMode);

        const requestBody = {
            model: options.model || 'qwen-turbo',
            messages: processedMessages
        };

        try {
            const response = await axios.post(this.baseURL, requestBody, {
                signal,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000
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
            console.error('[Qwen API] Error:', error.response?.data || error.message);
            throw new Error(`Qwen API failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async _callCLI(messages, options) {
        const { exec } = require('child_process');
        const lastMessage = messages[messages.length - 1].content;

        return new Promise((resolve, reject) => {
            exec(`qwen "${lastMessage}"`, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    console.error('[Qwen CLI] Error:', error, stderr);
                    return reject(new Error(`Qwen CLI failed: ${error.message || stderr}`));
                }
                resolve(this._normalizeResponse({
                    content: stdout.trim(),
                    model: 'qwen-cli',
                    usage: { total_tokens: 0 }
                }));
            });
        });
    }

    async getModels(forceRefresh = false) {
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        // Return cache if valid
        if (!forceRefresh && this.modelCache.models.length > 0 &&
            Date.now() - this.modelCache.lastSuccess < oneWeek) {
            return this.modelCache.models;
        }

        try {
            const models = await this._fetchModels();
            this.modelCache.models = models;
            this.modelCache.lastSuccess = Date.now();
            return models;
        } catch (error) {
            console.error('[Qwen] Model fetch failed:', error.message);
            if (this.modelCache.models.length > 0) {
                return this.modelCache.models;
            }
            return [];
        }
    }

    async _fetchModels() {
        // Try OAuth first
        const useOAuth = await this.db.getSetting('llm.qwen.useOAuth');
        if (useOAuth === 'true') {
            return this._fetchModelsOAuth();
        }

        // Try API key
        const apiKey = await this.db.getSetting('llm.qwen.apiKey');
        if (apiKey) {
            try {
                const response = await axios.get('https://dashscope.aliyuncs.com/api/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    timeout: 120000
                });
                if (response.data?.data?.length) {
                    return response.data.data.map(m => m.id);
                }
            } catch (error) {
                console.error('[Qwen] API key model fetch failed:', error.message);
            }
        }

        return [];
    }

    async _fetchModelsOAuth() {
        const oauthCredsStr = await this.db.getSetting('llm.qwen.oauthCreds');
        if (!oauthCredsStr) throw new Error('OAuth enabled but no credentials found');

        const oauthCreds = JSON.parse(oauthCredsStr);
        const token = oauthCreds.access_token;
        if (!token) throw new Error('No access token available');

        // Get API key from OAuth token
        const apiKeyResponse = await axios.get('https://portal.qwen.ai/api/v1/auth/api_key', {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 120000
        });

        const apiKey = apiKeyResponse.data.api_key;
        if (!apiKey) throw new Error('Failed to retrieve API key from OAuth');

        const response = await axios.get('https://dashscope.aliyuncs.com/api/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 120000
        });

        if (!response.data?.data?.length) throw new Error('Empty model list');
        return response.data.data.map(m => m.id);
    }

    /**
     * Qwen3 natively supports /think and /nothink prefixes.
     */
    _applyThinkingMode(messages, thinkingMode) {
        if (!thinkingMode || thinkingMode === 'off') return messages;

        const result = [...messages];
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

module.exports = QwenAdapter;
