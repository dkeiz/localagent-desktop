const axios = require('axios');
const dbService = require('./database');

class AIService {
  constructor(db, mcpServer = null) {
    this.db = db;
    this.mcpServer = mcpServer;
    this.currentProvider = 'ollama'; // Default provider
    this.systemPrompt = 'You are a helpful AI assistant with access to calendar and todo functions.';
    this.modelCache = {}; // Cache for fetched models
    this.abortController = null; // For stopping generation
    this.isGenerating = false;
    this.providers = {
      ollama: {
        baseURL: 'http://127.0.0.1:11434',
        models: ['llama2', 'mistral', 'codellama'],
        headers: {}
      },
      lmstudio: {
        baseURL: 'http://localhost:1234',
        models: [],
        headers: {}
      },
      openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        models: [],
        headers: {
          'Authorization': 'Bearer '
        }
      },
      qwen: {
        baseURL: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        models: [], // Removed hardcoded models
        headers: {}
      }
    };

    // Enhanced model cache with TTL and last success tracking
    this.modelCache = {
      qwen: {
        models: [],
        lastUpdated: 0,
        lastSuccess: 0
      }
    };
  }

  /**
   * Stop current generation
   */
  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.isGenerating = false;
      console.log('[AIService] Generation stopped by user');
      return true;
    }
    return false;
  }

  async initialize() {
    // Load provider from llm.provider setting (new) or ai_provider (old) or default to ollama
    const provider = await this.db.getSetting('llm.provider') || await this.db.getSetting('ai_provider') || 'ollama';
    this.currentProvider = provider;
    console.log('AI Service initialized with provider:', this.currentProvider);

    const savedPrompt = await this.db.getSetting('system_prompt');
    if (savedPrompt) this.systemPrompt = savedPrompt;

    // Load API keys
    for (const providerName of Object.keys(this.providers)) {
      const apiKey = await this.db.getSetting(`llm.${providerName}.apiKey`) || await this.db.getAPIKey(providerName);
      if (apiKey && this.providers[providerName].headers.Authorization) {
        this.providers[providerName].headers.Authorization = 'Bearer ' + apiKey;
      }
    }
  }

  async getModels(provider = null) {
    const targetProvider = provider || this.currentProvider;
    const config = this.providers[targetProvider];

    try {
      switch (targetProvider) {
        case 'ollama':
          const response = await axios.get(`${config.baseURL}/api/tags`);
          return response.data.models.map(m => m.name);

        case 'lmstudio':
          const lmResponse = await axios.get(`${config.baseURL}/v1/models`);
          return lmResponse.data.data.map(m => m.id);

        case 'openrouter':
          const orResponse = await axios.get(`${config.baseURL}/models`);
          return orResponse.data.data.map(m => m.id);

        case 'qwen':
          return this.getQwenModels();

        default:
          return [];
      }
    } catch (error) {
      console.error(`Error fetching models from ${targetProvider}:`, error.message);
      return [];
    }
  }

  // New method to handle Qwen model retrieval with enhanced caching
  async getQwenModels(forceRefresh = false) {
    const cache = this.modelCache.qwen;
    const oneWeek = 7 * 24 * 60 * 60 * 1000; // 1 week in ms

    // Return cache if valid and not forced
    if (!forceRefresh && cache.models.length > 0 && Date.now() - cache.lastSuccess < oneWeek) {
      console.log('Using valid Qwen cache');
      return cache.models;
    }

    try {
      const models = await this.fetchQwenModels();
      cache.models = models;
      cache.lastUpdated = Date.now();
      cache.lastSuccess = Date.now();
      console.log(`Fetched ${models.length} Qwen models successfully`);
      return models;
    } catch (error) {
      console.error('Qwen model fetch failed:', error);

      // Use last successful cache if available
      if (cache.models.length > 0) {
        console.log('Using cached models due to API error');
        return cache.models;
      }

      throw new Error('Failed to fetch Qwen models and no cache available');
    }
  }

  // New method to fetch Qwen models from API
  async fetchQwenModels() {
    const useOAuth = await this.db.getSetting('llm.qwen.useOAuth');

    if (useOAuth !== 'true') {
      throw new Error('Qwen OAuth is required but not enabled');
    }

    const oauthCredsStr = await this.db.getSetting('llm.qwen.oauthCreds');
    if (!oauthCredsStr) throw new Error('OAuth enabled but no credentials found');

    const oauthCreds = JSON.parse(oauthCredsStr);
    const token = oauthCreds.access_token;

    if (!token) throw new Error('No access token available');

    try {
      // First get API key using OAuth token
      const apiKeyResponse = await axios.get('https://portal.qwen.ai/api/v1/auth/api_key', {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 120000
      });

      const apiKey = apiKeyResponse.data.api_key;
      if (!apiKey) throw new Error('Failed to retrieve API key from OAuth token');

      // Use DashScope API for model listing with the API key
      const response = await axios.get('https://dashscope.aliyuncs.com/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 120000
      });

      // Validate response
      if (!response.data?.data?.length) {
        throw new Error('API returned empty model list');
      }

      return response.data.data.map(m => m.id);
    } catch (error) {
      console.error('Qwen model fetch error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch models: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async sendMessage(message, conversationHistory = [], options = {}) {
    // Build system prompt with active rules
    let fullSystemPrompt = this.systemPrompt;
    const activeRules = await this.db.getActivePromptRules();
    if (activeRules && activeRules.length > 0) {
      const rulesText = activeRules.map(r => r.content).join('\n');
      fullSystemPrompt += `\n\nActive Rules:\n${rulesText}`;
    }

    // Build MCP tool context (separate from system prompt)
    let mcpContext = '';
    if (this.mcpServer) {
      // Use getActiveTools() to only include tools from active groups
      const activeTools = this.mcpServer.getActiveTools ? this.mcpServer.getActiveTools() : [];
      const tools = activeTools.length > 0
        ? activeTools
        : this.mcpServer.getTools(); // Fallback to all tools if groups not loaded
      console.log(`[AI sendMessage] Using ${activeTools.length > 0 ? 'ACTIVE' : 'ALL'} tools, count: ${tools.length}`);
      console.log(`[AI sendMessage] Tool names:`, tools.map(t => t.name));
      const docs = this.mcpServer.getToolsDocumentation();

      mcpContext = `\n\n<mcp_tools>\nAvailable Tools (from active groups):\n\n`;

      // Create a map of tool docs for easy lookup
      const docsMap = new Map(docs.map(doc => [doc.name, doc]));

      tools.forEach(tool => {
        // Get activation state
        const isActive = this.mcpServer.toolStates.get(tool.name) !== false;
        const status = isActive ? '✅ Available' : '⚠️ Disabled (permission required)';

        mcpContext += `## ${tool.name} [${status}]\n`;
        mcpContext += `Description: ${tool.description}\n`;

        // Add parameters with detailed descriptions
        if (tool.inputSchema?.properties) {
          const props = tool.inputSchema.properties;
          const required = tool.inputSchema.required || [];
          mcpContext += `Parameters:\n`;

          Object.entries(props).forEach(([key, prop]) => {
            const isRequired = required.includes(key);
            const defaultVal = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
            const requiredMark = isRequired ? ' [REQUIRED]' : '';
            mcpContext += `  - ${key} (${prop.type})${requiredMark}${defaultVal}: ${prop.description || 'No description'}\n`;
          });
        }

        // Add usage example
        if (tool.example) {
          mcpContext += `Example: ${tool.example}\n`;
        }

        mcpContext += `\n`;
      });

      mcpContext += `\n## How to Use Tools\n`;
      mcpContext += `Format: TOOL:tool_name{"param":"value"}\n`;
      mcpContext += `Use the APPROPRIATE tool for each request. Match the tool to the user's actual question.\n`;
      mcpContext += `If a tool times out or fails, tell the user the tool didn't respond - do NOT call a different tool instead.\n`;
      mcpContext += `Always use the exact JSON format shown in examples.\n`;
      mcpContext += `\n## Important Rules\n`;
      mcpContext += `- Only call tools directly relevant to what the user asked\n`;
      mcpContext += `- If the user asks for weather, use weather/web tools, NOT time tools\n`;
      mcpContext += `- If a tool fails, explain the failure to the user instead of trying other tools\n`;
      mcpContext += `- Don't repeat the same tool call from earlier in the conversation\n`;
      mcpContext += `</mcp_tools>`;
      fullSystemPrompt += mcpContext;
    }

    const messages = [
      { role: 'system', content: fullSystemPrompt },
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    try {
      const model = await this.db.getSetting('llm.model');
      if (!model) {
        throw new Error('No model configured. Please select and save a model in the settings.');
      }
      const newOptions = { ...options, model };

      switch (this.currentProvider) {
        case 'ollama':
          return await this._callOllama(messages, newOptions);

        case 'lmstudio':
          return await this._callLMStudio(messages, options);

        case 'openrouter':
          return await this._callOpenRouter(messages, options);

        case 'qwen':
          const mode = await this.db.getSetting('llm.qwen.mode') || 'cli';
          if (mode === 'cli') {
            return await this._callQwenCLI(messages, options);
          } else {
            return await this._callQwenAPI(messages, options);
          }

        default:
          throw new Error(`Unsupported provider: ${this.currentProvider}`);
      }
    } catch (error) {
      console.error('AI service error:', error.message);
      throw error;
    }
  }

  async _callOllama(messages, options) {
    // Get model type (local or cloud) from settings
    const modelType = await this.db.getSetting('llm.modelType') || 'local';
    let contextLength = null;

    // Apply context window setting based on model type
    if (modelType === 'local') {
      const userContextWindow = await this.db.getSetting('context_window');
      contextLength = userContextWindow ? parseInt(userContextWindow) : 8192;
      console.log('Using context window for local model:', contextLength);
    } else {
      // Cloud models get 32k context by default (can be expensive but capable)
      contextLength = 32768;
      console.log('Using context window for cloud model:', contextLength);
    }

    const requestBody = {
      model: options.model,
      messages: messages,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9
      }
    };

    // Only add num_ctx for local models
    if (contextLength) {
      requestBody.options.num_ctx = contextLength;
    }

    // Create abort controller for this request
    this.abortController = new AbortController();
    this.isGenerating = true;

    try {
      const response = await axios.post(`${this.providers.ollama.baseURL}/api/chat`, requestBody, {
        signal: this.abortController.signal
      });

      this.isGenerating = false;
      this.abortController = null;

      return {
        content: response.data.message.content,
        model: response.data.model,
        usage: {
          prompt_tokens: response.data.prompt_eval_count || 0,
          completion_tokens: response.data.eval_count || 0,
          total_tokens: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0)
        },
        context_length: contextLength
      };
    } catch (error) {
      this.isGenerating = false;
      this.abortController = null;

      if (axios.isCancel(error) || error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        return { content: '[Generation stopped by user]', stopped: true };
      }
      throw error;
    }
  }

  async _callLMStudio(messages, options) {
    const response = await axios.post(`${this.providers.lmstudio.baseURL}/v1/chat/completions`, {
      model: options.model || '',
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 1000,
      stream: false
    }, {
      headers: this.providers.lmstudio.headers
    });

    return {
      content: response.data.choices[0].message.content,
      model: response.data.model,
      usage: response.data.usage
    };
  }

  async _callOpenRouter(messages, options) {
    const response = await axios.post(`${this.providers.openrouter.baseURL}/chat/completions`, {
      model: options.model || 'openrouter/auto',
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 1000,
      stream: false
    }, {
      headers: this.providers.openrouter.headers
    });

    return {
      content: response.data.choices[0].message.content,
      model: response.data.model,
      usage: response.data.usage
    };
  }

  async _callQwenAPI(messages, options) {
    const apiKey = await this.db.getSetting('llm.qwen.apiKey');
    if (!apiKey) throw new Error('Qwen API key not found');

    try {
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      };

      const requestBody = {
        model: options.model || 'qwen-turbo',
        messages: messages
      };

      const response = await axios.post(
        this.providers.qwen.baseURL,
        requestBody,
        { headers, timeout: 120000 }
      );

      return {
        content: response.data.choices[0].message.content,
        model: response.data.model,
        usage: response.data.usage
      };
    } catch (error) {
      console.error('Qwen API error:', error.response?.data || error.message);
      throw new Error(`Qwen API request failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async _callQwenCLI(messages, options) {
    const { exec } = require('child_process');
    const lastMessage = messages[messages.length - 1].content;

    return new Promise((resolve, reject) => {
      exec(`qwen "${lastMessage}"`, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          console.error('Qwen CLI error:', error, stderr);
          return reject(new Error(`Qwen CLI execution failed: ${error.message || stderr}`));
        }
        resolve({
          content: stdout.trim(),
          model: 'qwen-cli',
          usage: { total_tokens: 0 } // CLI doesn't provide token count
        });
      });
    });
  }

  async setProvider(provider) {
    if (!this.providers[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    this.currentProvider = provider;
    await this.db.setSetting('llm.provider', provider);
    console.log('Provider changed to:', provider);
  }

  async setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
    await this.db.setSetting('system_prompt', prompt);
  }

  async setAPIKey(provider, key) {
    if (!this.providers[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    await this.db.setAPIKey(provider, key);

    // Update in-memory configuration
    if (this.providers[provider].headers.Authorization) {
      const baseAuth = this.providers[provider].headers.Authorization.split(' ')[0];
      this.providers[provider].headers.Authorization = `${baseAuth} ${key}`;
    }
  }

  getCurrentProvider() {
    return this.currentProvider;
  }

  getSystemPrompt() {
    return this.systemPrompt;
  }

  getProviders() {
    return Object.keys(this.providers);
  }

  clearModelCache(provider = null) {
    if (provider) {
      delete this.modelCache[provider];
      console.log(`Cleared model cache for ${provider}`);
    } else {
      this.modelCache = {};
      console.log('Cleared all model caches');
    }
  }
}

module.exports = AIService;
