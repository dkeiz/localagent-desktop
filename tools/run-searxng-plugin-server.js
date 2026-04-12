const path = require('path');
const plugin = require(path.join(__dirname, '..', 'agentin', 'plugins', 'searxng-search', 'main.js'));

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function envNum(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

async function main() {
  const config = {
    enableLocalServer: envBool('SEARXNG_ENABLE_LOCAL_SERVER', true),
    localServerHost: process.env.SEARXNG_HOST || '127.0.0.1',
    localServerPort: envNum('SEARXNG_PORT', 8787),
    baseUrl: process.env.SEARXNG_BASE_URL || 'https://searx.be',
    discoveryUrls: process.env.SEARXNG_DISCOVERY_URLS || 'https://searx.be',
    timeoutMs: envNum('SEARXNG_TIMEOUT_MS', 4500),
    retryCount: envNum('SEARXNG_RETRY_COUNT', 0),
    defaultLanguage: process.env.SEARXNG_DEFAULT_LANGUAGE || 'en-US',
    defaultSafeSearch: envNum('SEARXNG_DEFAULT_SAFE_SEARCH', 1),
    defaultMaxResults: envNum('SEARXNG_DEFAULT_MAX_RESULTS', 8),
    backendMode: process.env.SEARXNG_BACKEND_MODE || 'embedded',
    backendAutoStart: envBool('SEARXNG_BACKEND_AUTOSTART', true),
    backendCommand: process.env.SEARXNG_BACKEND_COMMAND || '',
    backendArgs: process.env.SEARXNG_BACKEND_ARGS || '',
    backendWorkingDir: process.env.SEARXNG_BACKEND_CWD || '',
    backendBaseUrl: process.env.SEARXNG_BACKEND_BASE_URL || 'http://127.0.0.1:8080',
    backendHealthPath: process.env.SEARXNG_BACKEND_HEALTH_PATH || '/search?q=healthcheck&format=json',
    backendStartupTimeoutMs: envNum('SEARXNG_BACKEND_STARTUP_TIMEOUT_MS', 25000)
  };

  const handlers = new Map();
  const context = {
    pluginId: 'searxng-search',
    pluginDir: path.join(__dirname, '..', 'agentin', 'plugins', 'searxng-search'),
    getConfig(key) {
      if (typeof key === 'undefined') return { ...config };
      return config[key];
    },
    async setConfig(key, value) {
      config[key] = value;
    },
    registerHandler(name, definition, handler) {
      handlers.set(name, { definition, handler });
    },
    log(message) {
      console.log('[SearXNG Plugin]', message);
    }
  };

  await plugin.onEnable(context);
  const startResult = await plugin.runAction('start_server', {}, context);
  const localUrl = startResult?.local_server_url || context.getConfig('localServerUrl') || `http://${config.localServerHost}:${config.localServerPort}`;
  const backend = await plugin.runAction('server_status', {}, context);

  console.log('[SearXNG Plugin] READY');
  console.log('[SearXNG Plugin] Local URL:', localUrl);
  console.log('[SearXNG Plugin] Backend:', JSON.stringify(backend?.backend || {}, null, 2));
  console.log('[SearXNG Plugin] Health URL:', `${localUrl}/health`);
  console.log('[SearXNG Plugin] Search URL:', `${localUrl}/search?q=openai`);

  const shutdown = async () => {
    try {
      if (typeof plugin.onDisable === 'function') {
        await plugin.onDisable();
      }
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[SearXNG Plugin] FAIL:', error.message || error);
  process.exit(1);
});
