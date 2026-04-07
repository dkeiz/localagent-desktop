const axios = require('axios');
const {
  SPEC_FILE,
  getProviderProfiles,
  getModelRuntimeConfig,
  saveModelRuntimeConfig
} = require('../llm-config');

function registerLlmHandlers(ipcMain, runtime) {
  const {
    db,
    aiService,
    promptFileManager
  } = runtime;

  ipcMain.handle('getProviderModels', async (event, provider) => {
    try {
      const models = await aiService.getModels(provider);
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
      const models = await aiService.getModels(provider.toLowerCase(), forceRefresh);
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
      await db.saveSetting('llm.provider', config.provider);

      if (config.model) {
        await db.saveSetting('llm.model', config.model);
        if (config.provider === 'ollama') {
          const isCloudModel = config.model.includes('-cloud');
          await db.saveSetting('llm.modelType', isCloudModel ? 'cloud' : 'local');
        }
      }

      if (config.apiKey) {
        await db.saveSetting(`llm.${config.provider}.apiKey`, config.apiKey);
      }
      if (config.url) {
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
      } else if (config.useOAuth) {
        await db.saveSetting(`llm.${config.provider}.useOAuth`, 'true');
      }

      await aiService.setProvider(config.provider);

      let resolvedRuntime = null;
      if (config.model) {
        if (config.runtimeConfig) {
          const savedRuntime = await saveModelRuntimeConfig(db, config.provider, config.model, config.runtimeConfig);
          resolvedRuntime = savedRuntime.runtime;
        } else {
          const currentRuntime = await getModelRuntimeConfig(db, config.provider, config.model);
          resolvedRuntime = currentRuntime.runtime;
        }
      }

      if (resolvedRuntime) {
        await db.saveSetting('llm.thinkingMode', resolvedRuntime.reasoning?.enabled ? 'think' : 'off');
        await db.saveSetting('llm.showThinking', resolvedRuntime.reasoning?.visibility === 'hide' ? 'false' : 'true');
        await db.saveSetting('llm.thinkingVisibility', resolvedRuntime.reasoning?.visibility || 'show');
      }

      aiService.getModels(config.provider)
        .then(models => {
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
      const provider = await db.getSetting('llm.provider');
      const model = await db.getSetting('llm.model');
      const config = { provider, model };

      if (provider) {
        const apiKey = await db.getSetting(`llm.${provider}.apiKey`);
        const url = await db.getSetting(`llm.${provider}.url`);
        const mode = await db.getSetting(`llm.${provider}.mode`);
        const useOAuth = await db.getSetting(`llm.${provider}.useOAuth`);
        if (apiKey) config.apiKey = apiKey;
        if (url) config.url = url;
        if (mode) config.mode = mode;
        if (useOAuth === 'true') config.useOAuth = true;
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

  ipcMain.handle('llm:get-provider-profiles', async () => {
    return {
      specFile: SPEC_FILE,
      providers: getProviderProfiles()
    };
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
  ipcMain.handle('get-models', async (event, provider) => aiService.getModels(provider));

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
      return { success: true, model: result.model, content: result.content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('llm:set-thinking-mode', async (event, mode) => {
    const provider = await db.getSetting('llm.provider');
    const model = await db.getSetting('llm.model');

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      const runtimeConfig = profile.runtime;
      runtimeConfig.reasoning.enabled = mode === 'think';
      const saved = await saveModelRuntimeConfig(db, provider, model, runtimeConfig);
      await db.saveSetting('llm.thinkingMode', saved.runtime.reasoning.enabled ? 'think' : 'off');
      await db.saveSetting('llm.showThinking', saved.runtime.reasoning.visibility === 'hide' ? 'false' : 'true');
      await db.saveSetting('llm.thinkingVisibility', saved.runtime.reasoning.visibility || 'show');
    } else {
      await db.saveSetting('llm.thinkingMode', mode);
    }

    return { success: true, mode };
  });

  ipcMain.handle('llm:get-thinking-mode', async () => {
    const provider = await db.getSetting('llm.provider');
    const model = await db.getSetting('llm.model');

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
    const provider = await db.getSetting('llm.provider');
    const model = await db.getSetting('llm.model');

    if (provider && model) {
      const profile = await getModelRuntimeConfig(db, provider, model);
      profile.runtime.reasoning.visibility = show ? 'show' : 'hide';
      const saved = await saveModelRuntimeConfig(db, provider, model, profile.runtime);
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
