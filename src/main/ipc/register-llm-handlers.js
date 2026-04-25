const axios = require('axios');
const {
  SPEC_FILE,
  getProviderCatalogModels,
  getProviderConnectionConfig,
  getProviderProfiles,
  getProviderSpec,
  getModelRuntimeConfig,
  saveProviderConnectionConfig,
  saveModelRuntimeConfig
} = require('../llm-config');
const {
  getEffectiveLlmSelection,
  getKnownModelsForProvider,
  rememberLastWorkingModel,
  rememberTestedModel,
  saveActiveSelection
} = require('../llm-state');

function registerLlmHandlers(ipcMain, runtime) {
  const {
    db,
    aiService,
    promptFileManager
  } = runtime;

  async function syncResolvedRuntime(provider, model, runtimeConfig = null) {
    let resolvedRuntime = null;
    if (!provider || !model) {
      return resolvedRuntime;
    }

    if (runtimeConfig) {
      const savedRuntime = await saveModelRuntimeConfig(db, provider, model, runtimeConfig);
      resolvedRuntime = savedRuntime.runtime;
    } else {
      const currentRuntime = await getModelRuntimeConfig(db, provider, model);
      resolvedRuntime = currentRuntime.runtime;
    }

    if (resolvedRuntime) {
      await db.saveSetting('llm.thinkingMode', resolvedRuntime.reasoning?.enabled ? 'think' : 'off');
      await db.saveSetting('llm.showThinking', resolvedRuntime.reasoning?.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', resolvedRuntime.reasoning?.visibility || 'show');
    }

    return resolvedRuntime;
  }

  const DISCOVERED_MODELS_SETTING = 'llm.discoveredModels';

  function normalizeProviderId(provider) {
    return String(provider || '').trim().toLowerCase();
  }

  function normalizeModelList(models = []) {
    const seen = new Set();
    const output = [];
    for (const model of Array.isArray(models) ? models : []) {
      const value = String(model || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }

  async function getDiscoveredModelStore() {
    const raw = await db.getSetting(DISCOVERED_MODELS_SETTING);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  async function saveDiscoveredModelStore(store) {
    await db.saveSetting(DISCOVERED_MODELS_SETTING, JSON.stringify(store || {}));
  }

  async function rememberDiscoveredModels(provider, models = []) {
    const providerId = normalizeProviderId(provider);
    const normalized = normalizeModelList(models);
    if (!providerId || normalized.length === 0) return normalized;

    const store = await getDiscoveredModelStore();
    store[providerId] = {
      models: normalized,
      updatedAt: new Date().toISOString()
    };
    await saveDiscoveredModelStore(store);
    return normalized;
  }

  async function getCachedDiscoveredModels(provider) {
    const providerId = normalizeProviderId(provider);
    if (!providerId) return [];
    const store = await getDiscoveredModelStore();
    return normalizeModelList(store[providerId]?.models || []);
  }

  async function getCatalogAwareModels(provider, discovered = []) {
    const providerId = normalizeProviderId(provider);
    const providerSpec = getProviderSpec(providerId);
    const normalizedDiscovered = normalizeModelList(discovered);
    const openAITransport = providerId === 'openai'
      ? await db.getSetting('llm.openai.transport') || 'codex-cli'
      : '';
    if (providerId === 'openai' && openAITransport !== 'api-key') {
      return normalizedDiscovered.length > 0 ? normalizedDiscovered : ['gpt-5.2-codex'];
    }

    if (normalizedDiscovered.length > 0) {
      await rememberDiscoveredModels(providerId, normalizedDiscovered);
    }

    const cachedDiscovered = await getCachedDiscoveredModels(providerId);
    const shouldUseCatalogFallback = providerId !== 'openrouter';
    const seededModels = [
      ...(shouldUseCatalogFallback ? getProviderCatalogModels(providerId) : []),
      ...normalizedDiscovered,
      ...cachedDiscovered
    ];

    const models = await getKnownModelsForProvider(db, providerId, seededModels);

    // If discovery-capable provider has no models, still allow fallback catalog except OpenRouter
    // where stale static IDs are often misleading.
    if (models.length === 0 && shouldUseCatalogFallback && providerSpec?.settings?.supportsModelDiscovery) {
      return getKnownModelsForProvider(db, providerId, getProviderCatalogModels(providerId));
    }

    return models;
  }

  function normalizeConnectionPayload(config = {}) {
    const connection = { ...(config.connection || {}) };

    if (config.apiKey !== undefined) {
      connection.apiKey = config.apiKey;
    }
    if (config.url !== undefined) {
      connection.url = config.url;
    }

    return connection;
  }

  ipcMain.handle('getProviderModels', async (event, provider) => {
    try {
      const discovered = await aiService.getModels(provider);
      const models = await getCatalogAwareModels(provider, discovered);
      return { status: 'success', models };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });

  ipcMain.handle('checkProviderStatus', async (event, provider) => {
    try {
      const models = await aiService.getModels(provider);
      return { connected: models.length > 0 };
    } catch (error) {
      return { connected: false };
    }
  });

  ipcMain.handle('setActiveModel', async (event, provider, model) => {
    await db.setActiveModel(provider, model);
    return { success: true };
  });

  ipcMain.handle('llm:get-models', async (event, provider, forceRefresh = false) => {
    console.log('llm:get-models called with provider:', provider, 'forceRefresh:', forceRefresh);
    try {
      const providerId = normalizeProviderId(provider);
      const discovered = await aiService.getModels(providerId, forceRefresh);
      const models = await getCatalogAwareModels(providerId, discovered);
      console.log(`Models from ${provider}:`, models);
      return models;
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      return [];
    }
  });

  ipcMain.handle('llm:save-config', async (event, config) => {
    try {
      console.log('Saving config:', config);
      if (config.concurrencyEnabled !== undefined) {
        await db.saveSetting('llm.concurrency.enabled', config.concurrencyEnabled ? 'true' : 'false');
      }
      await saveActiveSelection(db, config.provider, config.model);

      const providerSpec = getProviderSpec(config.provider);
      const connection = normalizeConnectionPayload(config);
      if (providerSpec?.settings?.connectionFields?.length) {
        await saveProviderConnectionConfig(db, config.provider, connection);
      }
      if (config.apiKey !== undefined && !providerSpec?.settings?.connectionFields?.some(field => field.id === 'apiKey')) {
        if (config.apiKey) {
          await db.setAPIKey(config.provider, config.apiKey);
        }
      }
      if (config.url !== undefined && !providerSpec?.settings?.connectionFields?.some(field => field.id === 'url')) {
        await db.saveSetting(`llm.${config.provider}.url`, config.url);
      }

      if (config.provider === 'qwen') {
        const existingMode = await db.getSetting('llm.qwen.mode');
        const existingUseOAuth = (await db.getSetting('llm.qwen.useOAuth')) === 'true';
        const mode = config.mode || existingMode || 'cli';
        const useOAuth = config.useOAuth !== undefined
          ? config.useOAuth === true
          : (mode === 'oauth' || existingUseOAuth);
        await db.saveSetting('llm.qwen.mode', mode);
        await db.saveSetting('llm.qwen.useOAuth', useOAuth ? 'true' : 'false');
      } else if (config.provider === 'openai') {
        const transport = config.transport === 'api-key' ? 'api-key' : 'codex-cli';
        await db.saveSetting('llm.openai.transport', transport);
        if (config.codexSandbox) {
          await db.saveSetting('llm.openai.codexSandbox', config.codexSandbox);
        }
        if (config.codexSearch !== undefined) {
          await db.saveSetting('llm.openai.codexSearch', config.codexSearch ? 'true' : 'false');
        }
      } else if (config.useOAuth) {
        await db.saveSetting(`llm.${config.provider}.useOAuth`, 'true');
      }

      await aiService.setProvider(config.provider);

      let resolvedRuntime = null;
      if (config.model) {
        await rememberTestedModel(db, config.provider, config.model);
        resolvedRuntime = await syncResolvedRuntime(config.provider, config.model, config.runtimeConfig || null);
      }

      aiService.getModels(config.provider)
        .then(async models => {
          await getCatalogAwareModels(config.provider, models);
          console.log(`Refreshed ${models.length} models for ${config.provider}`);
        })
        .catch(err => {
          console.error(`Background model refresh failed for ${config.provider}:`, err);
        });

      console.log('Config saved successfully');
      return { success: true, runtimeConfig: resolvedRuntime };
    } catch (error) {
      console.error('Failed to save LLM config:', error);
      throw error;
    }
  });

  ipcMain.handle('llm:fetch-qwen-oauth', async () => {
    try {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');

      const oauthPath = path.join(os.homedir(), '.qwen', 'oauth_creds.json');
      if (fs.existsSync(oauthPath)) {
        const oauthData = fs.readFileSync(oauthPath, 'utf-8');
        const creds = JSON.parse(oauthData);
        console.log('Qwen OAuth file structure:', Object.keys(creds));
        await db.saveSetting('llm.qwen.oauthCreds', JSON.stringify(creds));
        await db.saveSetting('llm.qwen.useOAuth', 'true');
        return creds;
      }
      throw new Error('Qwen OAuth credentials not found at ~/.qwen/oauth_creds.json');
    } catch (error) {
      console.error('Failed to fetch Qwen OAuth:', error);
      throw error;
    }
  });

  ipcMain.handle('llm:get-config', async () => {
    try {
      const { provider, model, source } = await getEffectiveLlmSelection(db);
      const config = { provider, model };
      config.selectionSource = source;
      config.concurrencyEnabled = (await db.getSetting('llm.concurrency.enabled')) === 'true';

      if (provider) {
        config.providerLabel = getProviderSpec(provider)?.label || provider;
        const connection = await getProviderConnectionConfig(db, provider);
        const keyInfo = typeof db.getAPIKeyInfo === 'function'
          ? await db.getAPIKeyInfo(provider)
          : { configured: Boolean(await db.getAPIKey(provider)) };
        const url = await db.getSetting(`llm.${provider}.url`);
        const mode = await db.getSetting(`llm.${provider}.mode`);
        const useOAuth = await db.getSetting(`llm.${provider}.useOAuth`);
        config.connection = connection;
        config.apiKeyConfigured = Boolean(connection.apiKeyConfigured || keyInfo.configured);
        config.apiKeyEncrypted = Boolean(connection.apiKeyEncrypted || keyInfo.encrypted);
        if (connection.url || url) config.url = connection.url || url;
        if (mode) config.mode = mode;
        if (useOAuth === 'true') config.useOAuth = true;
        if (provider === 'openai') {
          config.transport = await db.getSetting('llm.openai.transport') || 'codex-cli';
          config.codexSandbox = await db.getSetting('llm.openai.codexSandbox') || 'read-only';
          config.codexSearch = (await db.getSetting('llm.openai.codexSearch')) === 'true';
        }
      }

      if (provider && model) {
        const { spec, runtime } = await getModelRuntimeConfig(db, provider, model);
        config.runtimeConfig = runtime;
        config.modelSpec = spec;
      }

      return config;
    } catch (error) {
      console.error('Failed to get LLM config:', error);
      return {};
    }
  });

  ipcMain.handle('llm:get-provider-connection-config', async (event, provider) => {
    if (!provider) return {};
    return getProviderConnectionConfig(db, provider);
  });

  ipcMain.handle('llm:get-provider-profiles', async () => {
    return {
      specFile: SPEC_FILE,
      providers: getProviderProfiles()
    };
  });

  ipcMain.handle('llm:codex-status', async () => {
    const adapter = aiService.adapters.openai;
    if (!adapter?.getCodexStatus) {
      return { installed: false, loggedIn: false, error: 'OpenAI Codex bridge unavailable' };
    }
    return adapter.getCodexStatus();
  });

  ipcMain.handle('llm:codex-login', async () => {
    const adapter = aiService.adapters.openai;
    if (!adapter?.launchCodexLogin) {
      return { launched: false, error: 'OpenAI Codex bridge unavailable' };
    }
    return adapter.launchCodexLogin();
  });

  ipcMain.handle('llm:get-model-profile', async (event, provider, model) => {
    if (!provider || !model) return null;
    const { spec, runtime } = await getModelRuntimeConfig(db, provider, model);
    return {
      specFile: SPEC_FILE,
      spec,
      runtimeConfig: runtime
    };
  });

  ipcMain.handle('llm:save-model-runtime', async (event, { provider, model, runtimeConfig }) => {
    if (!provider || !model) {
      throw new Error('Provider and model are required');
    }

    const saved = await saveModelRuntimeConfig(db, provider, model, runtimeConfig);
    const active = await getEffectiveLlmSelection(db);
    if (active.provider === provider && active.model === model) {
      await syncResolvedRuntime(provider, model, saved.runtime);
    }

    return {
      success: true,
      specFile: SPEC_FILE,
      spec: saved.spec,
      runtimeConfig: saved.runtime
    };
  });

  ipcMain.handle('stop-generation', async () => {
    const stopped = aiService.stopGeneration();
    if (runtime.chainController && runtime.chainController.stopChain) {
      runtime.chainController.stopChain();
    }
    return { stopped };
  });

  ipcMain.handle('is-generating', async () => ({ generating: aiService.isGenerating }));
  ipcMain.handle('get-ai-providers', async () => aiService.getProviders());
  ipcMain.handle('get-providers', async () => aiService.getProviders());
  ipcMain.handle('get-models', async (event, provider) => getCatalogAwareModels(provider, await aiService.getModels(provider)));

  ipcMain.handle('qwen:refresh-models', async () => {
    try {
      const models = await aiService.getModels('qwen');
      return { success: true, models };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('llm:test-model', async (event, { provider, model }) => {
    try {
      const adapter = aiService.adapters[provider];
      if (!adapter) return { success: false, error: `Unknown provider: ${provider}` };
      const result = await adapter.call(
        [{ role: 'user', content: 'hello' }],
        { model, max_tokens: 10 }
      );
      await rememberTestedModel(db, provider, model);
      await rememberLastWorkingModel(db, provider, model);
      await saveActiveSelection(db, provider, model);
      await aiService.setProvider(provider);
      const runtimeConfig = await syncResolvedRuntime(provider, model);
      return {
        success: true,
        model: result.model,
        content: result.content,
        remembered: true,
        runtimeConfig
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('llm:set-thinking-mode', async (event, mode) => {
    const { provider, model } = await getEffectiveLlmSelection(db);

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      const saved = await saveModelRuntimeConfig(db, provider, model, {
        reasoning: {
          ...profile.runtime.reasoning,
          enabled: mode === 'think'
        }
      });
      await db.saveSetting('llm.thinkingMode', saved.runtime.reasoning.enabled ? 'think' : 'off');
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.thinkingMode', mode);
    }

    return { success: true, mode };
  });

  ipcMain.handle('llm:get-thinking-mode', async () => {
    const { provider, model } = await getEffectiveLlmSelection(db);

    if (provider && model) {
      const { runtime } = await getModelRuntimeConfig(db, provider, model);
      return {
        mode: runtime.reasoning.enabled ? 'think' : 'off',
        showThinking: runtime.reasoning.visibility !== 'hide',
        visibility: runtime.reasoning.visibility
      };
    }

    const mode = await db.getSetting('llm.thinkingMode') || 'off';
    const show = await db.getSetting('llm.showThinking');
    return { mode, showThinking: show !== 'false', visibility: await db.getSetting('llm.thinkingVisibility') || 'show' };
  });

  ipcMain.handle('llm:set-show-thinking', async (event, show) => {
    const { provider, model } = await getEffectiveLlmSelection(db);

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      const saved = await saveModelRuntimeConfig(db, provider, model, {
        reasoning: {
          ...profile.runtime.reasoning,
          visibility: show ? 'show' : 'hide'
        }
      });
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.showThinking', show ? 'true' : 'false');
    }
    return { success: true };
  });

  ipcMain.handle('verify-qwen-key', async (event, apiKey) => {
    if (!apiKey || apiKey.trim() === '') {
      return { success: false, error: 'API key cannot be empty' };
    }
    try {
      const response = await axios.get('https://dashscope.aliyuncs.com/api/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        return { success: true, modelCount: response.data.data.length };
      }
      return { success: false, error: 'Invalid API response format' };
    } catch (error) {
      let errorMessage = 'API key verification failed';
      if (error.response) {
        if (error.response.status === 401) {
          errorMessage = 'Invalid API key: Unauthorized';
        } else if (error.response.data && error.response.data.error) {
          errorMessage = `API error: ${error.response.data.error.message || error.response.data.error}`;
        } else {
          errorMessage = `API returned status ${error.response.status}`;
        }
      } else if (error.request) {
        errorMessage = 'No response from Qwen API server';
      } else {
        errorMessage = `Request setup error: ${error.message}`;
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle('set-ai-provider', async (event, provider) => {
    await aiService.setProvider(provider);
    return { success: true, provider };
  });

  ipcMain.handle('set-ai-model', async (event, model) => {
    await db.saveSetting('llm.model', model);
    return { success: true };
  });

  ipcMain.handle('set-system-prompt', async (event, prompt) => {
    await aiService.setSystemPrompt(prompt);
    if (promptFileManager) {
      await promptFileManager.saveSystemPrompt(prompt, false);
    }
    return { success: true };
  });

  ipcMain.handle('get-system-prompt', async () => {
    try {
      const prompt = await db.getSetting('system_prompt');
      return prompt || 'You are a helpful AI assistant.';
    } catch (error) {
      console.error('Error getting system prompt:', error);
      return 'You are a helpful AI assistant.';
    }
  });

  ipcMain.handle('get-context-setting', async () => {
    try {
      return await db.getSetting('context_window') || '8192';
    } catch (error) {
      console.error('Error getting context setting:', error);
      return '8192';
    }
  });

  ipcMain.handle('set-context-setting', async (_, value) => {
    try {
      const numValue = parseInt(value);
      if (isNaN(numValue)) throw new Error('Invalid number');
      if (numValue < 2048 || numValue > 262144) {
        throw new Error('Value must be between 2048 and 262144');
      }
      await db.setSetting('context_window', numValue.toString());
      console.log('Context saved:', numValue);
      return { success: true };
    } catch (error) {
      console.error('Context save error:', error.message);
      throw error;
    }
  });

  ipcMain.handle('get-setting-value', async (_, key) => {
    try {
      return await db.getSetting(key);
    } catch (error) {
      console.error(`Error getting setting ${key}:`, error);
      return null;
    }
  });

  ipcMain.handle('prompt:get-paths', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    return promptFileManager.getPaths();
  });

  ipcMain.handle('prompt:sync-from-files', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    await promptFileManager.syncFromFiles();
    const systemPrompt = await promptFileManager.loadSystemPrompt();
    await aiService.setSystemPrompt(systemPrompt);
    return { success: true };
  });

  ipcMain.handle('prompt:sync-to-files', async () => {
    if (!promptFileManager) return { error: 'PromptFileManager not initialized' };
    await promptFileManager.syncToFiles();
    return { success: true };
  });

  ipcMain.handle('prompt:get-system', async () => {
    if (!promptFileManager) return aiService.getSystemPrompt();
    return promptFileManager.loadSystemPrompt();
  });

  ipcMain.handle('prompt:set-system', async (event, content) => {
    if (promptFileManager) {
      await promptFileManager.saveSystemPrompt(content, true);
    }
    await aiService.setSystemPrompt(content);
    return { success: true };
  });

  ipcMain.handle('prompt:get-rules-from-files', async () => {
    if (!promptFileManager) return [];
    return promptFileManager.loadRulesFromFiles();
  });
}

module.exports = { registerLlmHandlers };
