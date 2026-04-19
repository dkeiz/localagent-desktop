'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

function cleanBaseUrl(value) {
  return String(value || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl, requestPath) {
  const path = String(requestPath || '').trim() || '/';
  return new URL(path.startsWith('/') ? path : `/${path}`, cleanBaseUrl(baseUrl)).toString();
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseVoiceOptions(raw) {
  return String(raw || 'default')
    .split(/[,\n]/g)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => ({ id: value, name: value }));
}

function parseJsonMap(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function readConfigFile(context) {
  const rawPath = String(context.getConfig('configFile') || '').trim();
  if (!rawPath) return {};
  const filePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(context.pluginDir, rawPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return { __configError: error.message, __configFile: filePath };
  }
}

function getByPath(source, pathList) {
  const paths = String(pathList || '')
    .split('|')
    .map(path => path.trim())
    .filter(Boolean);

  for (const entry of paths) {
    const value = entry.split('.').reduce((current, key) => {
      if (current == null) return undefined;
      return current[key];
    }, source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function replaceTokens(value, vars) {
  if (Array.isArray(value)) return value.map(item => replaceTokens(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, vars)]));
  }
  if (typeof value !== 'string') return value;

  const exact = value.match(/^\{([^{}]+)\}$/);
  if (exact && vars[exact[1]] !== undefined) return vars[exact[1]];
  return value.replace(/\{([^{}]+)\}/g, (match, key) => {
    const replacement = vars[key];
    return replacement === undefined || replacement === null ? match : String(replacement);
  });
}

function makeTemplateVars(params, voice, speed) {
  const agent = params.agent || {};
  return {
    text: String(params.text || ''),
    voice,
    speed,
    style: params.style || '',
    sessionId: params.sessionId || '',
    'agent.id': agent.id || '',
    'agent.name': agent.name || '',
    'agent.slug': agent.slug || '',
    agentId: agent.id || '',
    agentName: agent.name || '',
    agentSlug: agent.slug || ''
  };
}

function buildRequestPayload(params, cfg, voice, speed) {
  const fallback = {
    [cfg.textField]: String(params.text || ''),
    [cfg.voiceField]: voice,
    [cfg.speedField]: speed
  };
  const template = cfg.requestTemplate;
  if (!template || (typeof template === 'string' && !template.trim())) return fallback;
  const vars = makeTemplateVars(params, voice, speed);

  if (template && typeof template === 'object') {
    return replaceTokens(template, vars);
  }

  try {
    return replaceTokens(JSON.parse(String(template).trim()), vars);
  } catch (_) {
    return replaceTokens(String(template), vars);
  }
}

function appendQuery(url, payload) {
  const parsed = new URL(url);
  const entries = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.entries(payload)
    : [['input', String(payload || '')]];
  entries.forEach(([key, value]) => {
    if (value !== undefined && value !== null) parsed.searchParams.set(key, String(value));
  });
  return parsed.toString();
}

function getConfig(context) {
  const fileConfig = readConfigFile(context);
  const request = fileConfig.request || {};
  const response = fileConfig.response || {};
  const voices = fileConfig.voices || {};
  return {
    serverUrl: cleanBaseUrl(context.getConfig('serverUrl')),
    style: context.getConfig('style') || fileConfig.style || 'default',
    apiKey: context.getConfig('apiKey') || fileConfig.apiKey || '',
    configError: fileConfig.__configError || '',
    configFile: fileConfig.__configFile || '',
    synthesizePath: request.path || fileConfig.synthesizePath || context.getConfig('synthesizePath') || '/tts',
    synthesizeMethod: String(request.method || fileConfig.synthesizeMethod || context.getConfig('synthesizeMethod') || 'POST').toUpperCase(),
    requestMode: String(request.mode || fileConfig.requestMode || context.getConfig('requestMode') || 'json').toLowerCase(),
    requestTemplate: request.template || fileConfig.requestTemplate || context.getConfig('requestTemplate') || '',
    headersJson: JSON.stringify(request.headers || fileConfig.headers || parseJsonMap(context.getConfig('headersJson'))),
    apiKeyHeader: request.apiKeyHeader || fileConfig.apiKeyHeader || 'Authorization',
    apiKeyPrefix: request.apiKeyPrefix || fileConfig.apiKeyPrefix || 'Bearer ',
    voicesPath: voices.path || fileConfig.voicesPath || context.getConfig('voicesPath') || '/voices',
    healthPath: context.getConfig('probePath') || fileConfig.probePath || fileConfig.healthPath || context.getConfig('healthPath') || '/health',
    textField: request.textField || fileConfig.requestTextField || context.getConfig('requestTextField') || 'text',
    voiceField: request.voiceField || fileConfig.requestVoiceField || context.getConfig('requestVoiceField') || 'voice',
    speedField: request.speedField || fileConfig.requestSpeedField || context.getConfig('requestSpeedField') || 'speed',
    styleField: request.styleField || fileConfig.requestStyleField || 'style',
    audioUrlField: response.audioUrlField || fileConfig.responseAudioUrlField || context.getConfig('responseAudioUrlField') || 'audio_url',
    audioUrlPath: response.audioUrlPath || fileConfig.responseAudioUrlPath || context.getConfig('responseAudioUrlPath') || 'audio.url|audio_url|audioUrl|url',
    audioBase64Field: response.audioBase64Field || fileConfig.responseAudioBase64Field || context.getConfig('responseAudioBase64Field') || 'audio_base64',
    audioBase64Path: response.audioBase64Path || fileConfig.responseAudioBase64Path || context.getConfig('responseAudioBase64Path') || 'audio.base64|audio_base64|audioBase64|base64',
    mimeTypePath: response.mimeTypePath || fileConfig.responseMimeTypePath || context.getConfig('responseMimeTypePath') || 'audio.mimeType|mimeType|mime_type|content_type',
    voicesResponsePath: voices.responsePath || fileConfig.voicesResponsePath || context.getConfig('voicesResponsePath') || 'voices|data.voices|data',
    defaultVoice: fileConfig.defaultVoice || context.getConfig('defaultVoice') || 'default',
    voiceOptions: Array.isArray(voices.fallback) ? voices.fallback.join('\n') : fileConfig.voiceOptions || context.getConfig('voiceOptions') || 'default',
    speed: parseNumber(fileConfig.speed || context.getConfig('speed'), 1),
    agentVoiceOverrides: JSON.stringify(fileConfig.agentVoiceOverrides || parseJsonMap(context.getConfig('agentVoiceOverrides')))
  };
}

async function ensureDefaults(context) {
  const defaults = {
    serverUrl: 'http://127.0.0.1:8000',
    style: 'default',
    apiKey: '',
    configFile: 'config.txt',
    probePath: '/health'
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (context.getConfig(key) == null) {
      await context.setConfig(key, value);
    }
  }
}

function resolveVoice(params, cfg) {
  const overrides = parseJsonMap(cfg.agentVoiceOverrides);
  const agent = params.agent || {};
  return params.voice
    || overrides[String(agent.id || '')]
    || overrides[String(agent.slug || '')]
    || overrides[String(agent.name || '')]
    || cfg.defaultVoice
    || 'default';
}

function normalizeAudioUrl(rawUrl, cfg) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    return new URL(value, cfg.serverUrl).toString();
  } catch (_) {
    return value;
  }
}

async function speak(params, context) {
  const cfg = getConfig(context);
  if (cfg.configError) {
    throw new Error(`TTS config file error: ${cfg.configError}`);
  }
  const voice = resolveVoice(params, cfg);
  const speed = parseNumber(params.speed, cfg.speed);
  const payload = buildRequestPayload({ ...params, style: params.style || cfg.style }, cfg, voice, speed);
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && cfg.styleField && !payload[cfg.styleField]) {
    payload[cfg.styleField] = params.style || cfg.style;
  }
  const headers = {
    Accept: 'application/json,audio/*,text/plain,*/*',
    ...parseJsonMap(cfg.headersJson)
  };
  if (cfg.apiKey && cfg.apiKeyHeader) {
    headers[cfg.apiKeyHeader] = `${cfg.apiKeyPrefix || ''}${cfg.apiKey}`;
  }

  let url = joinUrl(cfg.serverUrl, cfg.synthesizePath);
  const method = cfg.synthesizeMethod === 'GET' ? 'GET' : 'POST';
  const request = { method, headers };

  if (method === 'GET' || cfg.requestMode === 'query') {
    url = appendQuery(url, payload);
  } else if (cfg.requestMode === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    request.body = new URLSearchParams(payload).toString();
  } else if (typeof payload === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'text/plain; charset=utf-8';
    request.body = payload;
  } else {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    request.body = JSON.stringify(payload);
  }

  const response = await fetch(url, request);

  if (!response.ok) {
    throw new Error(`TTS server returned HTTP ${response.status}`);
  }

  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.startsWith('audio/') || contentType === 'application/octet-stream') {
    const buffer = await response.buffer();
    return {
      ok: true,
      voice,
      mimeType: contentType.split(';')[0] || 'audio/wav',
      audioBase64: buffer.toString('base64')
    };
  }

  if (contentType.startsWith('text/plain')) {
    return {
      ok: true,
      voice,
      audioUrl: normalizeAudioUrl(await response.text(), cfg),
      mimeType: 'audio/wav'
    };
  }

  const data = await response.json();
  const audioUrl = getByPath(data, cfg.audioUrlPath) || data[cfg.audioUrlField];
  const audioBase64 = getByPath(data, cfg.audioBase64Path) || data[cfg.audioBase64Field];
  const mimeType = getByPath(data, cfg.mimeTypePath) || 'audio/wav';
  return {
    ok: true,
    voice,
    mimeType,
    audioUrl: normalizeAudioUrl(audioUrl, cfg),
    audioBase64: audioBase64 || '',
    durationMs: Number(getByPath(data, 'durationMs|duration_ms') || 0)
  };
}

async function listVoices(context) {
  const cfg = getConfig(context);
  if (cfg.configError) {
    return { voices: parseVoiceOptions(cfg.voiceOptions), fallback: true, error: cfg.configError };
  }
  try {
    const headers = parseJsonMap(cfg.headersJson);
    if (cfg.apiKey && cfg.apiKeyHeader) headers[cfg.apiKeyHeader] = `${cfg.apiKeyPrefix || ''}${cfg.apiKey}`;
    const response = await fetch(joinUrl(cfg.serverUrl, cfg.voicesPath), { method: 'GET', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const raw = Array.isArray(data) ? data : getByPath(data, cfg.voicesResponsePath);
    const voices = Array.isArray(raw)
      ? raw.map(voice => typeof voice === 'string'
        ? { id: voice, name: voice }
        : { id: String(voice.id || voice.name || ''), name: String(voice.name || voice.id || '') })
      : [];
    return { voices: voices.filter(voice => voice.id) };
  } catch (error) {
    return { voices: parseVoiceOptions(cfg.voiceOptions), fallback: true, error: error.message };
  }
}

async function healthCheck(context) {
  const cfg = getConfig(context);
  if (cfg.configError) {
    return { ok: false, error: cfg.configError, configFile: cfg.configFile };
  }
  const headers = parseJsonMap(cfg.headersJson);
  if (cfg.apiKey && cfg.apiKeyHeader) headers[cfg.apiKeyHeader] = `${cfg.apiKeyPrefix || ''}${cfg.apiKey}`;
  const response = await fetch(joinUrl(cfg.serverUrl, cfg.healthPath), { method: 'GET', headers });
  return { ok: response.ok, status: response.status, serverUrl: cfg.serverUrl, style: cfg.style };
}

module.exports = {
  async onEnable(context) {
    await ensureDefaults(context);
    context.log('HTTP TTS bridge ready');
  },

  async runAction(action, params, context) {
    if (action === 'speak') return speak(params || {}, context);
    if (action === 'listVoices') return listVoices(context);
    if (action === 'previewVoice') return speak(params || {}, context);
    if (action === 'healthCheck' || action === 'discover' || action === 'probe') return healthCheck(context);
    if (action === 'stop') return { ok: true, localOnly: true };
    throw new Error(`Unknown TTS action: ${action}`);
  }
};
