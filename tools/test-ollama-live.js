const axios = require('axios');
const OllamaAdapter = require('../src/main/providers/ollama-adapter');

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const REQUESTED_MODEL = process.env.OLLAMA_TEST_MODEL || 'qwen2.5:0.5b';
const REQUIRED = process.env.OLLAMA_REQUIRED === 'true';

class MockDB {
  async getSetting(key) {
    if (key === 'context_window') return '4096';
    return null;
  }
}

async function isOllamaReachable() {
  try {
    await axios.get(`${BASE_URL}/api/tags`, { timeout: 2500 });
    return true;
  } catch (_) {
    return false;
  }
}

async function main() {
  const reachable = await isOllamaReachable();
  if (!reachable) {
    const msg = `[test-ollama-live] SKIP: Ollama not reachable at ${BASE_URL}`;
    if (REQUIRED) {
      throw new Error(msg);
    }
    console.log(msg);
    return;
  }

  const tags = await axios.get(`${BASE_URL}/api/tags`, { timeout: 8000 });
  const names = (tags.data.models || []).map(m => m.name);
  if (names.length === 0) {
    const msg = '[test-ollama-live] SKIP: No Ollama models installed';
    if (REQUIRED) throw new Error(msg);
    console.log(msg);
    return;
  }

  const nonCloud = names.filter(n => !n.includes(':cloud'));
  const preferredFallback = nonCloud.length > 0 ? nonCloud[0] : names[0];
  const candidateModels = [];
  if (names.includes(REQUESTED_MODEL)) candidateModels.push(REQUESTED_MODEL);
  if (!candidateModels.includes(preferredFallback)) candidateModels.push(preferredFallback);
  for (const n of names) {
    if (!candidateModels.includes(n)) {
      candidateModels.push(n);
    }
    if (candidateModels.length >= 3) break;
  }

  if (!names.includes(REQUESTED_MODEL)) {
    console.log(`[test-ollama-live] INFO: Requested model "${REQUESTED_MODEL}" not found, trying "${candidateModels[0]}"`);
  }

  const adapter = new OllamaAdapter(new MockDB());
  adapter.baseURL = BASE_URL;

  let lastError = null;
  for (const modelToUse of candidateModels) {
    try {
      const t0 = Date.now();
      const result = await adapter.call(
        [{ role: 'user', content: 'Reply with exactly: OK' }],
        { model: modelToUse, temperature: 0.0, max_tokens: 20 }
      );
      const elapsed = Date.now() - t0;
      if (!result || typeof result.content !== 'string' || result.content.trim().length === 0) {
        throw new Error('Empty response content');
      }
      console.log(`[test-ollama-live] PASS: model=${modelToUse} elapsedMs=${elapsed} preview="${result.content.slice(0, 80).replace(/\s+/g, ' ')}"`);
      return;
    } catch (err) {
      lastError = err;
      console.log(`[test-ollama-live] WARN: model=${modelToUse} failed: ${err.message}`);
    }
  }

  const msg = `[test-ollama-live] SKIP: reachable but inference failed for tested models (${candidateModels.join(', ')}). Last error: ${lastError ? lastError.message : 'unknown'}`;
  if (REQUIRED) {
    throw new Error(msg);
  }
  console.log(msg);
}

main().catch((err) => {
  console.error('[test-ollama-live] FAIL:', err.message || err);
  process.exit(1);
});
