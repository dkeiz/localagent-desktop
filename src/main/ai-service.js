const OllamaAdapter = require('./providers/ollama-adapter');
const LMStudioAdapter = require('./providers/lmstudio-adapter');
const OpenRouterAdapter = require('./providers/openrouter-adapter');
const QwenAdapter = require('./providers/qwen-adapter');

/**
 * AIService — Manages LLM provider adapters and routing.
 *
 * All actual inference is delegated to provider adapters.
 * This class handles:
 *   - Provider registration and switching
 *   - Config persistence (provider, model, API keys)
 *   - Routing sendMessage → adapter.call()
 */
class AIService {
  constructor(db, mcpServer = null) {
    this.db = db;
    this.mcpServer = mcpServer;
    this.currentProvider = 'ollama';
    this.systemPrompt = 'You are a helpful AI assistant with access to calendar and todo functions.';

    // Provider adapters
    this.adapters = {
      ollama: new OllamaAdapter(db),
      lmstudio: new LMStudioAdapter(db),
      openrouter: new OpenRouterAdapter(db),
      qwen: new QwenAdapter(db)
    };
  }

  /**
   * Stop current generation — delegates to active adapter.
   */
  stopGeneration() {
    const adapter = this.adapters[this.currentProvider];
    if (adapter) {
      return adapter.stop();
    }
    return false;
  }

  /**
   * Check if currently generating.
   */
  get isGenerating() {
    const adapter = this.adapters[this.currentProvider];
    return adapter ? adapter.isGenerating : false;
  }

  async initialize() {
    // Load provider setting
    const provider = await this.db.getSetting('llm.provider') ||
      await this.db.getSetting('ai_provider') || 'ollama';
    this.currentProvider = provider;
    console.log('AI Service initialized with provider:', this.currentProvider);

    // Load system prompt
    const savedPrompt = await this.db.getSetting('system_prompt');
    if (savedPrompt) this.systemPrompt = savedPrompt;
  }

  /**
   * Send messages to the current LLM provider.
   *
   * @param {Array} messages - Pre-built [{role, content}, ...] array
   * @param {Object} options - { model, temperature, max_tokens, thinkingMode, ... }
   * @returns {Object} { content, model, usage, stopped? }
   */
  async sendMessage(messages, options = {}) {
    const adapter = this.adapters[this.currentProvider];
    if (!adapter) {
      throw new Error(`Unsupported provider: ${this.currentProvider}`);
    }

    try {
      return await adapter.call(messages, options);
    } catch (error) {
      console.error(`[AIService] ${this.currentProvider} error:`, error.message);
      throw error;
    }
  }

  /**
   * Get models for a specific provider.
   */
  async getModels(provider = null) {
    const targetProvider = provider || this.currentProvider;
    const adapter = this.adapters[targetProvider];
    if (!adapter) return [];

    try {
      return await adapter.getModels();
    } catch (error) {
      console.error(`Error fetching models from ${targetProvider}:`, error.message);
      return [];
    }
  }

  async setProvider(provider) {
    if (!this.adapters[provider]) {
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
    if (!this.adapters[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    // Save to new-style setting
    await this.db.setSetting(`llm.${provider}.apiKey`, key);
    // Also save to legacy location for backward compat
    await this.db.setAPIKey(provider, key);
  }

  getCurrentProvider() {
    return this.currentProvider;
  }

  getSystemPrompt() {
    return this.systemPrompt;
  }

  getProviders() {
    return Object.keys(this.adapters);
  }
}

module.exports = AIService;
