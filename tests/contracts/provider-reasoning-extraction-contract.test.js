const fs = require('fs');
const path = require('path');
const OpenAICompatibleAdapter = require('../../src/main/providers/openai-compatible-adapter');
const OpenRouterAdapter = require('../../src/main/providers/openrouter-adapter');
const LMStudioAdapter = require('../../src/main/providers/lmstudio-adapter');
const QwenAdapter = require('../../src/main/providers/qwen-adapter');

module.exports = {
  name: 'provider-reasoning-extraction-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const nullDb = {
      async getSetting() { return null; },
      async getAPIKey() { return null; }
    };

    const openaiCompat = new OpenAICompatibleAdapter('byok', nullDb, { apiKeyOptional: true });
    assert.equal(
      openaiCompat._extractReasoning({ reasoning_content: 'trace-a' }, {}),
      'trace-a',
      'Expected OpenAI-compatible adapter to read reasoning_content'
    );

    const openrouter = new OpenRouterAdapter(nullDb);
    assert.equal(
      openrouter._extractReasoning({ reasoning: 'trace-b' }, {}),
      'trace-b',
      'Expected OpenRouter adapter to read reasoning'
    );

    const lmstudio = new LMStudioAdapter(nullDb);
    assert.equal(
      lmstudio._extractReasoning({ reasoning_content: 'trace-c' }, {}),
      'trace-c',
      'Expected LM Studio adapter to read reasoning_content'
    );

    const qwen = new QwenAdapter(nullDb);
    const qwenNormalized = qwen._extractMessage({
      output: {
        choices: [{ message: { content: 'final', thinking: 'trace-d' } }]
      }
    });
    assert.equal(
      qwenNormalized.reasoning,
      'trace-d',
      'Expected Qwen adapter to map thinking fields to reasoning output'
    );

    const ollamaSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'providers', 'ollama-adapter.js'), 'utf8');
    const openaiCompatSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'providers', 'openai-compatible-adapter.js'), 'utf8');
    const openrouterSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'providers', 'openrouter-adapter.js'), 'utf8');
    const lmstudioSource = fs.readFileSync(path.join(rootDir, 'src', 'main', 'providers', 'lmstudio-adapter.js'), 'utf8');
    assert.includes(ollamaSource, 'message.thinking', 'Expected Ollama adapter to read message.thinking');
    assert.includes(ollamaSource, 'response.data?.thinking', 'Expected Ollama adapter to read response.data.thinking');
    assert.equal(openaiCompatSource.includes('message.thinking'), false, 'Expected OpenAI-compatible adapter not to rely on message.thinking');
    assert.equal(openrouterSource.includes('message.thinking'), false, 'Expected OpenRouter adapter not to rely on message.thinking');
    assert.equal(lmstudioSource.includes('message.thinking'), false, 'Expected LM Studio adapter not to rely on message.thinking');
  }
};
