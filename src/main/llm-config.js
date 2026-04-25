const path = require('path');
const rawSpecs = require('./llm-model-specs.json');

const SPEC_FILE = path.join(__dirname, 'llm-model-specs.json');
const VISIBILITY_MODES = ['show', 'min', 'hide'];
const PROVIDERS_WITH_PARALLEL_TOGGLE = new Set(['ollama', 'lmstudio', 'local-openai']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, extra) {
  if (!isPlainObject(base)) return clone(extra);
  const output = clone(base) || {};

  if (!isPlainObject(extra)) {
    return output;
  }

  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
    } else if (isPlainObject(value)) {
      output[key] = mergeDeep(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPatternRegex(pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function buildModelMatchCandidates(model) {
  const raw = String(model || '').trim();
  if (!raw) return [];

  const normalized = raw
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/:+/g, ':')
    .trim();

  const candidates = new Set([raw, normalized]);

  const slashParts = normalized.split('/').filter(Boolean);
  if (slashParts.length > 1) {
    candidates.add(slashParts[slashParts.length - 1]);
  }

  const colonParts = normalized.split(':').filter(Boolean);
  if (colonParts.length > 1) {
    candidates.add(colonParts[0]);
  }

  if (slashParts.length > 1 && colonParts.length > 1) {
    const tail = slashParts[slashParts.length - 1];
    const tailColonParts = tail.split(':').filter(Boolean);
    if (tailColonParts.length > 1) {
      candidates.add(tailColonParts[0]);
    }
  }

  return Array.from(candidates);
}

function matchesModel(model, patterns = []) {
  const candidates = buildModelMatchCandidates(model);
  return patterns.some(pattern => {
    const regex = toPatternRegex(pattern);
    return candidates.some(name => regex.test(name));
  });
}

function getProviderSpec(provider) {
  return rawSpecs.providers[normalizeId(provider)] || null;
}

function getProviderCatalogModels(provider) {
  const providerSpec = getProviderSpec(provider);
  return Array.isArray(providerSpec?.catalog) ? clone(providerSpec.catalog) : [];
}

function getProviderConnectionFields(provider) {
  const providerSpec = getProviderSpec(provider);
  return Array.isArray(providerSpec?.settings?.connectionFields)
    ? clone(providerSpec.settings.connectionFields)
    : [];
}

function getModelFamily(provider, model) {
  const providerSpec = getProviderSpec(provider);
  if (!providerSpec || !model) return null;
  return (providerSpec.models || []).find(entry => matchesModel(model, entry.match || []))
    || getSyntheticModelFamily(provider, model);
}

function getSyntheticModelFamily(provider, model) {
  const providerId = normalizeId(provider);
  const normalized = normalizeId(model);
  if (providerId !== 'openai' || !normalized.includes('codex')) {
    return null;
  }

  if (normalized.startsWith('gpt-5.2-codex')) {
    return {
      id: 'openai-codex-frontier',
      label: 'OpenAI Codex Frontier',
      runtime: {
        reasoning: {
          enabled: true,
          effort: 'medium'
        },
        contextWindow: {
          value: 400000
        }
      },
      capabilities: {
        reasoning: {
          supported: true,
          toggle: true,
          effortLevels: ['low', 'medium', 'high', 'xhigh'],
          outputChannel: 'separate',
          parameterMode: 'openai_reasoning_effort',
          defaultEnabled: true
        },
        contextWindow: {
          supported: true,
          configurable: false,
          max: 400000
        },
        modalities: {
          vision: true
        }
      },
      notes: [
        'Codex-optimized model family for agentic coding and long-horizon tasks.'
      ]
    };
  }

  if (normalized.startsWith('gpt-5-codex') || normalized.startsWith('gpt-5.1-codex')) {
    return {
      id: 'openai-codex-5.1',
      label: 'OpenAI Codex 5.1',
      runtime: {
        reasoning: {
          enabled: true,
          effort: 'medium'
        },
        contextWindow: {
          value: 400000
        }
      },
      capabilities: {
        reasoning: {
          supported: true,
          toggle: true,
          effortLevels: ['low', 'medium', 'high', 'xhigh'],
          outputChannel: 'separate',
          parameterMode: 'openai_reasoning_effort',
          defaultEnabled: true
        },
        contextWindow: {
          supported: true,
          configurable: false,
          max: 400000
        },
        modalities: {
          vision: true
        }
      },
      notes: [
        'Codex-optimized GPT-5.1 family for coding agents.'
      ]
    };
  }

  return null;
}

function resolveModelSpec(provider, model) {
  const providerId = normalizeId(provider);
  const providerSpec = getProviderSpec(providerId);
  const defaults = clone(rawSpecs.defaults) || {};

  if (!providerSpec) {
    return {
      provider: providerId,
      model: model || '',
      specFile: SPEC_FILE,
      family: null,
      settings: {},
      runtime: defaults.runtime || {},
      capabilities: defaults.capabilities || {},
      notes: defaults.notes || []
    };
  }

  const family = getModelFamily(providerId, model);
  const merged = mergeDeep(
    mergeDeep(defaults, providerSpec),
    family || {}
  );

  const capabilities = merged.capabilities || clone(defaults.capabilities) || {};
  const concurrencyCaps = inferConcurrencyCapabilities({
    provider: providerId,
    capabilities
  });
  capabilities.concurrency = {
    ...(isPlainObject(capabilities.concurrency) ? capabilities.concurrency : {}),
    ...concurrencyCaps
  };

  return {
    provider: providerId,
    providerLabel: providerSpec.label || providerId,
    model: model || '',
    family: family ? {
      id: family.id || null,
      label: family.label || family.id || 'Matched family'
    } : null,
    specFile: SPEC_FILE,
    settings: merged.settings || {},
    runtime: merged.runtime || clone(defaults.runtime) || {},
    capabilities,
    notes: merged.notes || []
  };
}

function inferConcurrencyCapabilities(spec) {
  const explicit = isPlainObject(spec?.capabilities?.concurrency)
    ? spec.capabilities.concurrency
    : {};
  const provider = normalizeId(spec?.provider);
  const supported = explicit.supported !== undefined
    ? Boolean(explicit.supported)
    : PROVIDERS_WITH_PARALLEL_TOGGLE.has(provider);
  return {
    supported,
    sameProvider: explicit.sameProvider !== undefined ? Boolean(explicit.sameProvider) : supported
  };
}

function getProviderProfiles() {
  return Object.entries(rawSpecs.providers).map(([id, spec]) => ({
    id,
    label: spec.label || id,
    description: spec.description || '',
    catalog: clone(spec.catalog) || [],
    settings: clone(spec.settings) || {},
    notes: clone(spec.notes) || []
  }));
}

function parseJsonSetting(rawValue, fallback = {}) {
  if (!rawValue) return clone(fallback);
  try {
    const parsed = JSON.parse(rawValue);
    return isPlainObject(parsed) ? parsed : clone(fallback);
  } catch (_) {
    return clone(fallback);
  }
}

function getOverrideKey(provider, model) {
  return `${normalizeId(provider)}::${normalizeId(model)}`;
}

function getConnectionSettingKey(provider, fieldId) {
  return `llm.${normalizeId(provider)}.${fieldId}`;
}

function sanitizeContextWindow(spec, candidate) {
  const contextCaps = spec.capabilities?.contextWindow || {};
  const defaults = spec.runtime?.contextWindow || {};
  const presets = Array.isArray(contextCaps.presets)
    ? contextCaps.presets.map(parsePositiveInteger).filter(Boolean)
    : [];
  const fallback = parsePositiveInteger(defaults.value) || 8192;

  if (!contextCaps.configurable) {
    return { value: fallback };
  }

  let value = parsePositiveInteger(candidate?.value) || fallback;

  if (presets.length > 0 && !presets.includes(value)) {
    value = presets.reduce((best, preset) => {
      return Math.abs(preset - value) < Math.abs(best - value) ? preset : best;
    }, presets[0]);
  }

  if (contextCaps.min) {
    value = Math.max(contextCaps.min, value);
  }
  if (contextCaps.max) {
    value = Math.min(contextCaps.max, value);
  }

  return { value };
}

function sanitizeRequestOverrides(spec, candidate) {
  const defaults = isPlainObject(spec.runtime?.requestOverrides) ? spec.runtime.requestOverrides : {};
  const supported = Boolean(spec.capabilities?.requestOverrides?.supported);
  if (!supported) return clone(defaults);
  return isPlainObject(candidate) ? clone(candidate) : clone(defaults);
}

function sanitizeRuntimeConfig(spec, candidate = {}) {
  const effective = mergeDeep(spec.runtime || {}, candidate || {});
  const capabilities = spec.capabilities || {};
  const reasoningCaps = capabilities.reasoning || {};
  const streamingCaps = capabilities.streaming || {};
  const routingCaps = capabilities.providerRouting || {};
  const concurrencyCaps = inferConcurrencyCapabilities(spec);

  const sanitized = {
    reasoning: {
      enabled: Boolean(effective.reasoning?.enabled),
      visibility: VISIBILITY_MODES.includes(effective.reasoning?.visibility)
        ? effective.reasoning.visibility
        : (spec.runtime?.reasoning?.visibility || 'show'),
      effort: effective.reasoning?.effort || spec.runtime?.reasoning?.effort || 'medium',
      maxTokens: effective.reasoning?.maxTokens ?? spec.runtime?.reasoning?.maxTokens ?? null
    },
    streaming: {
      text: Boolean(effective.streaming?.text),
      reasoning: Boolean(effective.streaming?.reasoning)
    },
    providerRouting: {
      requireParameters: Boolean(effective.providerRouting?.requireParameters)
    },
    concurrency: {
      allowParallel: Boolean(effective.concurrency?.allowParallel)
    },
    contextWindow: sanitizeContextWindow(spec, effective.contextWindow),
    requestOverrides: sanitizeRequestOverrides(spec, effective.requestOverrides)
  };

  if (!reasoningCaps.supported) {
    sanitized.reasoning.enabled = false;
    sanitized.reasoning.effort = null;
    sanitized.reasoning.maxTokens = null;
  } else {
    if (!reasoningCaps.toggle) {
      sanitized.reasoning.enabled = Boolean(spec.runtime?.reasoning?.enabled);
    }

    const levels = Array.isArray(reasoningCaps.effortLevels) ? reasoningCaps.effortLevels : [];
    if (levels.length === 0) {
      sanitized.reasoning.effort = null;
    } else if (!levels.includes(sanitized.reasoning.effort)) {
      sanitized.reasoning.effort = spec.runtime?.reasoning?.effort && levels.includes(spec.runtime.reasoning.effort)
        ? spec.runtime.reasoning.effort
        : levels[0];
    }

    if (!reasoningCaps.maxTokens) {
      sanitized.reasoning.maxTokens = null;
    } else if (sanitized.reasoning.maxTokens !== null) {
      const parsed = Number.parseInt(sanitized.reasoning.maxTokens, 10);
      sanitized.reasoning.maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }

  sanitized.streaming.text = streamingCaps.text ? sanitized.streaming.text : false;
  sanitized.streaming.reasoning = streamingCaps.reasoning !== 'none' ? sanitized.streaming.reasoning : false;
  sanitized.providerRouting.requireParameters = routingCaps.requireParameters
    ? sanitized.providerRouting.requireParameters
    : false;
  sanitized.concurrency.allowParallel = concurrencyCaps.supported
    ? sanitized.concurrency.allowParallel
    : false;

  return sanitized;
}

async function getStoredModelOverrides(db) {
  const rawValue = await db.getSetting('llm.modelOverrides');
  return parseJsonSetting(rawValue, {});
}

async function getModelRuntimeConfig(db, provider, model) {
  const spec = resolveModelSpec(provider, model);
  const overrides = await getStoredModelOverrides(db);
  const runtime = sanitizeRuntimeConfig(spec, overrides[getOverrideKey(provider, model)] || {});
  return { spec, runtime };
}

async function saveModelRuntimeConfig(db, provider, model, runtimeConfig) {
  const spec = resolveModelSpec(provider, model);
  const overrides = await getStoredModelOverrides(db);
  const key = getOverrideKey(provider, model);
  const currentOverride = isPlainObject(overrides[key]) ? overrides[key] : {};
  const mergedRuntime = mergeDeep(currentOverride, runtimeConfig || {});
  const sanitized = sanitizeRuntimeConfig(spec, mergedRuntime);
  const shouldPersistContextWindow = Object.prototype.hasOwnProperty.call(currentOverride, 'contextWindow')
    || Object.prototype.hasOwnProperty.call(runtimeConfig || {}, 'contextWindow');
  if (!shouldPersistContextWindow) {
    delete sanitized.contextWindow;
  }
  overrides[key] = sanitized;
  await db.saveSetting('llm.modelOverrides', JSON.stringify(overrides));
  return { spec, runtime: sanitized };
}

function normalizeStoredConnectionValue(field, rawValue) {
  if (field.type === 'checkbox') {
    if (typeof rawValue === 'boolean') return rawValue;
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return Boolean(field.defaultValue);
    }
    return String(rawValue) === 'true';
  }

  if (field.type === 'json') {
    return parseJsonSetting(rawValue, field.defaultValue || {});
  }

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return field.defaultValue ?? '';
  }

  return rawValue;
}

function serializeConnectionValue(field, value) {
  if (field.type === 'checkbox') {
    return value ? 'true' : 'false';
  }

  if (field.type === 'json') {
    return JSON.stringify(isPlainObject(value) ? value : (field.defaultValue || {}));
  }

  return value === undefined || value === null ? '' : String(value);
}

async function getProviderConnectionConfig(db, provider) {
  const fields = getProviderConnectionFields(provider);
  const output = {};

  for (const field of fields) {
    if (field.id === 'apiKey') {
      const info = typeof db.getAPIKeyInfo === 'function'
        ? await db.getAPIKeyInfo(provider)
        : { configured: Boolean(await db.getAPIKey(provider)) };
      output.apiKey = '';
      output.apiKeyConfigured = Boolean(info.configured);
      output.apiKeyEncrypted = Boolean(info.encrypted);
      continue;
    }

    const rawValue = await db.getSetting(getConnectionSettingKey(provider, field.id));
    output[field.id] = normalizeStoredConnectionValue(field, rawValue);
  }

  return output;
}

async function saveProviderConnectionConfig(db, provider, connection = {}) {
  const fields = getProviderConnectionFields(provider);
  const saved = {};

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(connection, field.id)) {
      continue;
    }

    const serialized = serializeConnectionValue(field, connection[field.id]);
    if (field.id === 'apiKey') {
      if (serialized) {
        await db.setAPIKey(normalizeId(provider), serialized);
      }
      saved.apiKeyConfigured = Boolean(serialized) || Boolean((await db.getAPIKeyInfo?.(provider))?.configured);
      saved.apiKeyEncrypted = Boolean((await db.getAPIKeyInfo?.(provider))?.encrypted);
      continue;
    }

    await db.saveSetting(getConnectionSettingKey(provider, field.id), serialized);
    saved[field.id] = normalizeStoredConnectionValue(field, serialized);
  }

  return saved;
}

module.exports = {
  SPEC_FILE,
  getProviderProfiles,
  getProviderSpec,
  getProviderCatalogModels,
  getProviderConnectionFields,
  getProviderConnectionConfig,
  saveProviderConnectionConfig,
  getConnectionSettingKey,
  getModelFamily,
  resolveModelSpec,
  sanitizeRuntimeConfig,
  getModelRuntimeConfig,
  saveModelRuntimeConfig,
  getStoredModelOverrides,
  getOverrideKey
};
