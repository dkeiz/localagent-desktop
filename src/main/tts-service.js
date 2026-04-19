const {
  getCapabilityContract,
  normalizeTtsSpeakResult,
  normalizeTtsVoices
} = require('./plugin-capability-contracts');

class TtsService {
  constructor({ db, pluginManager, agentManager }) {
    this.db = db;
    this.pluginManager = pluginManager;
    this.agentManager = agentManager;
  }

  _bool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  }

  _number(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getSettings() {
    return {
      defaultPluginId: await this.db.getSetting('tts.defaultPluginId') || '',
      voice: await this.db.getSetting('tts.voice') || '',
      speed: this._number(await this.db.getSetting('tts.speed'), 1),
      autoSpeak: this._bool(await this.db.getSetting('tts.autoSpeak'), false)
    };
  }

  async saveSettings(settings = {}) {
    const allowed = ['defaultPluginId', 'voice', 'speed', 'autoSpeak'];
    for (const key of allowed) {
      if (settings[key] !== undefined) {
        await this.db.saveSetting(`tts.${key}`, String(settings[key]));
      }
    }
    return this.getSettings();
  }

  getContract() {
    return getCapabilityContract('tts');
  }

  listProviders({ enabledOnly = true } = {}) {
    if (!this.pluginManager?.getPluginsByCapability) return [];
    return this.pluginManager.getPluginsByCapability('tts', { enabledOnly })
      .map(provider => ({ ...provider, contract: provider.contract || this.getContract() }));
  }

  async _resolvePluginId(requestedPluginId = '') {
    const providers = this.listProviders({ enabledOnly: true });
    if (requestedPluginId && providers.some(provider => provider.id === requestedPluginId)) {
      return requestedPluginId;
    }

    const settings = await this.getSettings();
    if (settings.defaultPluginId && providers.some(provider => provider.id === settings.defaultPluginId)) {
      return settings.defaultPluginId;
    }

    return providers[0]?.id || '';
  }

  async _getAgentInfo(agentId) {
    if (!agentId || !this.agentManager?.getAgent) return null;
    const agent = await this.agentManager.getAgent(agentId);
    if (!agent) return null;
    const slug = agent.slug || (this.agentManager._getSafeFolderName
      ? this.agentManager._getSafeFolderName(agent.name)
      : String(agent.name || agentId).toLowerCase().replace(/\s+/g, '-'));
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      slug
    };
  }

  async listVoices(params = {}) {
    const pluginId = await this._resolvePluginId(params.pluginId);
    if (!pluginId) return { success: false, error: 'No enabled TTS plugin', voices: [] };
    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'listVoices', params);
      return { success: true, pluginId, contract: 'tts.v1', voices: normalizeTtsVoices(result) };
    } catch (error) {
      return { success: false, pluginId, error: error.message, voices: [] };
    }
  }

  async speak(params = {}) {
    const text = String(params.text || '').trim();
    if (!text) return { success: false, error: 'Text is required' };

    const pluginId = await this._resolvePluginId(params.pluginId);
    if (!pluginId) return { success: false, error: 'No enabled TTS plugin' };

    const settings = await this.getSettings();
    const agent = await this._getAgentInfo(params.agentId);
    const payload = {
      ...params,
      text,
      voice: params.voice || settings.voice,
      speed: params.speed || settings.speed,
      settings,
      agent
    };

    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'speak', payload);
      const normalized = normalizeTtsSpeakResult(result);
      return { success: normalized.ok, pluginId, result: normalized };
    } catch (error) {
      return { success: false, pluginId, error: error.message };
    }
  }

  async stop(params = {}) {
    const pluginId = await this._resolvePluginId(params.pluginId);
    if (!pluginId) return { success: true, stopped: true, localOnly: true };
    try {
      const result = await this.pluginManager.runPluginAction(pluginId, 'stop', params);
      return { success: true, pluginId, result };
    } catch (error) {
      return { success: true, pluginId, warning: error.message };
    }
  }
}

module.exports = TtsService;
