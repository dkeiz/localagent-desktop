const path = require('path');
const rawSpecs = require('./llm-model-specs.json');

const SPEC_FILE = path.join(__dirname, 'llm-model-specs.json');
const VISIBILITY_MODES = ['show', 'min', 'hide'];

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

function toPatternRegex(pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesModel(model, patterns = []) {
  const name = String(model || '').trim();
  return patterns.some(pattern => toPatternRegex(pattern).test(name));
}

function getProviderSpec(provider) {
  return rawSpecs.providers[normalizeId(provider)] || null;
}

function getModelFamily(provider, model) {
  const providerSpec = getProviderSpec(provider);
  if (!providerSpec || !model) return null;
  return (providerSpec.models || []).find(entry => matchesModel(model, entry.match || [])) || null;
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
    capabilities: merged.capabilities || clone(defaults.capabilities) || {},
    notes: merged.notes || []
  };
}

function getProviderProfiles() {
  return Object.entries(rawSpecs.providers).map(([id, spec]) => ({
    id,
    label: spec.label || id,
    description: spec.description || '',
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

function sanitizeRuntimeConfig(spec, candidate = {}) {
  const effective = mergeDeep(spec.runtime || {}, candidate || {});
  const capabilities = spec.capabilities || {};
  const reasoningCaps = capabilities.reasoning || {};
  const streamingCaps = capabilities.streaming || {};
  const routingCaps = capabilities.providerRouting || {};

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
    }
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
  const sanitized = sanitizeRuntimeConfig(spec, runtimeConfig);
  overrides[key] = sanitized;
  await db.saveSetting('llm.modelOverrides', JSON.stringify(overrides));
  return { spec, runtime: sanitized };
}

module.exports = {
  SPEC_FILE,
  getProviderProfiles,
  getProviderSpec,
  getModelFamily,
  resolveModelSpec,
  sanitizeRuntimeConfig,
  getModelRuntimeConfig,
  saveModelRuntimeConfig,
  getStoredModelOverrides,
  getOverrideKey
};
