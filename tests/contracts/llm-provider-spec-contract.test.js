const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'llm-provider-spec-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const specPath = path.join(rootDir, 'src', 'main', 'llm-model-specs.json');
    const llmConfigPath = path.join(rootDir, 'src', 'main', 'llm-config.js');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const llmConfigSource = fs.readFileSync(llmConfigPath, 'utf8');

    ['openai', 'groq', 'deepseek', 'mistral', 'anthropic', 'byok', 'local-openai'].forEach(providerId => {
      assert.ok(spec.providers[providerId], `Expected provider registry entry for ${providerId}`);
    });

    assert.equal(spec.providers.openai.label, 'OpenAI / ChatGPT API', 'Expected OpenAI provider label to reflect ChatGPT API positioning');
    assert.ok(
      spec.providers.openai.settings.connectionFields.some(field => field.id === 'apiKey'),
      'Expected OpenAI provider to require an API key field'
    );
    assert.ok(
      spec.providers.byok.settings.connectionFields.some(field => field.id === 'url'),
      'Expected BYOK provider to expose a base URL field'
    );
    assert.equal(
      spec.providers['local-openai'].settings.supportsRequestOverrides,
      true,
      'Expected local OpenAI-compatible provider to allow request overrides'
    );

    const gpt52Family = spec.providers.openai.models.find(model => model.id === 'openai-gpt-5.2');
    assert.equal(
      gpt52Family.capabilities.reasoning.parameterMode,
      'openai_reasoning_effort',
      'Expected GPT-5.2 family to map reasoning effort through the OpenAI parameter'
    );

    assert.includes(llmConfigSource, 'async function getProviderConnectionConfig', 'Expected provider connection config loader in llm-config');
    assert.includes(llmConfigSource, 'async function saveProviderConnectionConfig', 'Expected provider connection config saver in llm-config');
    assert.includes(llmConfigSource, 'function getProviderCatalogModels', 'Expected catalog model helper in llm-config');
  }
};
