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
            return this._callAPI(messages, options, mode);
        }
    }

    async _callAPI(messages, options, mode = 'api') {
        const signal = this._startRequest();
        let apiKey = await this.db.getSetting('llm.qwen.apiKey');
        const useOAuth = mode === 'oauth' || (await this.db.getSetting('llm.qwen.useOAuth')) === 'true';

        if (useOAuth) {
            apiKey = await this._getApiKeyFromOAuth();
        }

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
        const escapedMessage = String(lastMessage || '').replace(/"/g, '\\"');
        const escapedModel = String(options.model || '').replace(/"/g, '\\"');
        const modelArg = escapedModel && escapedModel !== 'qwen-cli' ? ` --model "${escapedModel}"` : '';

        return new Promise((resolve, reject) => {
            exec(`qwen${modelArg} "${escapedMessage}"`, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    console.error('[Qwen CLI] Error:', error, stderr);
                    return reject(new Error(`Qwen CLI failed: ${error.message || stderr}`));
                }
                resolve(this._normalizeResponse({
                    content: stdout.trim(),
                    model: options.model || 'qwen-cli',
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
            let models = await this._fetchModels();

            // Fallback to CLI-based discovery if API/OAuth returned nothing
            if (!models || models.length === 0) {
                models = await this._fetchModelsCLI();
            }

            this.modelCache.models = models;
            this.modelCache.lastSuccess = Date.now();
            return models;
        } catch (error) {
            console.error('[Qwen] Model fetch failed:', error.message);

            // Last-chance fallback via CLI discovery
            try {
                const cliModels = await this._fetchModelsCLI();
                if (cliModels.length > 0) {
                    this.modelCache.models = cliModels;
                    this.modelCache.lastSuccess = Date.now();
                    return cliModels;
                }
            } catch (cliError) {
                console.error('[Qwen] CLI model fetch failed:', cliError.message);
            }

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
                const models = this._extractModelsFromApiResponse(response.data);
                if (models.length > 0) {
                    return models;
                }
            } catch (error) {
                console.error('[Qwen] API key model fetch failed:', error.message);
            }
        }

        return [];
    }

    async _fetchModelsOAuth() {
        const apiKey = await this._getApiKeyFromOAuth();

        const response = await axios.get('https://dashscope.aliyuncs.com/api/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 120000
        });

        const models = this._extractModelsFromApiResponse(response.data);
        if (models.length === 0) throw new Error('Empty model list');
        return models;
    }

    async _getApiKeyFromOAuth() {
        const oauthCredsStr = await this.db.getSetting('llm.qwen.oauthCreds');
        if (!oauthCredsStr) throw new Error('OAuth enabled but no credentials found');

        const oauthCreds = JSON.parse(oauthCredsStr);
        const token = oauthCreds.access_token || oauthCreds.token || oauthCreds.id_token || oauthCreds.accessToken;
        if (!token) throw new Error('No access token available');

        // Get API key from OAuth token
        const apiKeyResponse = await axios.get('https://portal.qwen.ai/api/v1/auth/api_key', {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 120000
        });

        const apiKey = apiKeyResponse?.data?.api_key || apiKeyResponse?.data?.data?.api_key || apiKeyResponse?.data?.key;
        if (!apiKey) throw new Error('Failed to retrieve API key from OAuth');
        return apiKey;
    }

    _extractModelsFromApiResponse(payload) {
        const raw = [];
        if (Array.isArray(payload?.data)) raw.push(...payload.data);
        if (Array.isArray(payload?.models)) raw.push(...payload.models);
        if (Array.isArray(payload?.output?.models)) raw.push(...payload.output.models);

        const models = raw
            .map(m => (typeof m === 'string' ? m : (m?.id || m?.model || m?.name || m?.model_id)))
            .filter(Boolean)
            .map(String);

        return Array.from(new Set(models));
    }

    async _fetchModelsCLI() {
        const { exec } = require('child_process');

        const argCandidates = [
            'models',
            'list-models',
            'model list',
            'list models',
            '--models',
            '--list-models'
        ];

        for (const args of argCandidates) {
            try {
                const text = await new Promise((resolve, reject) => {
                    exec(`qwen ${args}`, { timeout: 8000 }, (error, stdout, stderr) => {
                        if (error && !stdout && !stderr) return reject(error);
                        resolve(`${stdout || ''}\n${stderr || ''}`.trim());
                    });
                });
                const parsed = this._parseModelsFromCliText(text);
                if (parsed.length > 0) return parsed;
            } catch (_) {
                // Try next candidate
            }
        }

        return [];
    }

    _parseModelsFromCliText(text) {
        if (!text) return [];

        const stop = new Set(['model', 'models', 'name', 'available', 'installed', 'default']);
        const out = new Set();

        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || /^[-=|+]+$/.test(trimmed)) continue;

            const first = trimmed.split(/\s+/)[0];
            if (!first) continue;
            if (stop.has(first.toLowerCase())) continue;
            if (!/^[a-zA-Z0-9._:/-]{3,}$/.test(first)) continue;

            out.add(first);
        }

        return Array.from(out);
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
