'use strict';

const { DEFAULT_PIPER_VOICE_ID } = require('./config');

function normalizeProvider(provider, voiceId) {
  const explicit = String(provider || '').trim().toLowerCase();
  if (explicit === 'browser' || explicit === 'piper' || explicit === 'fast-qwen') {
    return explicit;
  }

  const voice = String(voiceId || '').trim().toLowerCase();
  if (voice.startsWith('piper:')) return 'piper';
  if (voice.startsWith('qwen-builtin:') || voice.startsWith('qwen-clone:')) return 'fast-qwen';
  return 'fast-qwen';
}

function resolveVoiceChoice(params = {}, config = {}) {
  const provider = normalizeProvider(params.provider, params.voice);
  const rawVoice = String(params.voice || '').trim();

  if (provider === 'browser') {
    return {
      provider,
      selectedVoiceId: 'browser',
      backendVoice: '',
      modelName: '',
      usePlugin: false
    };
  }

  if (provider === 'piper') {
    const voiceId = rawVoice.startsWith('piper:') ? rawVoice.slice('piper:'.length) : (rawVoice || config.piperVoiceId || DEFAULT_PIPER_VOICE_ID);
    return {
      provider,
      selectedVoiceId: `piper:${voiceId}`,
      backendVoice: voiceId,
      modelName: `piper:${voiceId}`,
      usePlugin: true
    };
  }

  if (rawVoice.startsWith('qwen-clone:')) {
    const voiceName = rawVoice.slice('qwen-clone:'.length) || 'clone_voice';
    return {
      provider: 'fast-qwen',
      selectedVoiceId: `qwen-clone:${voiceName}`,
      backendVoice: voiceName,
      modelName: config.cloneModel,
      usePlugin: true,
      voiceKind: 'clone'
    };
  }

  const builtinVoice = rawVoice.startsWith('qwen-builtin:')
    ? rawVoice.slice('qwen-builtin:'.length)
    : (rawVoice || 'serena');
  return {
    provider: 'fast-qwen',
    selectedVoiceId: `qwen-builtin:${builtinVoice}`,
    backendVoice: builtinVoice,
    modelName: config.builtinModel,
    usePlugin: true,
    voiceKind: 'builtin'
  };
}

function buildVoiceCatalog(voiceResponse = {}, modelsResponse = {}) {
  const builtinVoices = Array.isArray(voiceResponse.builtin_voices) ? voiceResponse.builtin_voices : [];
  const customVoices = Array.isArray(voiceResponse.custom_voices) ? voiceResponse.custom_voices : [];
  const modelItems = Array.isArray(modelsResponse.items) ? modelsResponse.items : [];

  const voices = [];
  for (const voice of builtinVoices) {
    voices.push({
      id: `qwen-builtin:${voice.name}`,
      name: voice.name,
      provider: 'fast-qwen',
      kind: 'builtin',
      description: voice.description || 'Fast Qwen built-in voice'
    });
  }
  for (const voice of customVoices) {
    voices.push({
      id: `qwen-clone:${voice.name}`,
      name: voice.name,
      provider: 'fast-qwen',
      kind: 'clone',
      description: voice.description || 'Prepared custom Qwen clone voice'
    });
  }
  for (const item of modelItems) {
    if (!String(item.id || '').startsWith('piper:')) continue;
    const voiceId = String(item.id).slice('piper:'.length);
    voices.push({
      id: `piper:${voiceId}`,
      name: voiceId,
      provider: 'piper',
      kind: 'builtin',
      status: item.status || 'missing',
      description: item.detail || 'Piper local voice'
    });
  }
  return voices;
}

module.exports = {
  buildVoiceCatalog,
  normalizeProvider,
  resolveVoiceChoice
};
