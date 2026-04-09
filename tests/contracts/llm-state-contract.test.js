const {
  getEffectiveLlmSelection,
  getKnownModelsForProvider,
  rememberLastWorkingModel,
  rememberTestedModel,
  saveActiveSelection
} = require('../../src/main/llm-state');

function createDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async getSetting(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async saveSetting(key, value) {
      store.set(key, value);
    },
    dump() {
      return store;
    }
  };
}

module.exports = {
  name: 'llm-state-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = createDb({
      'llm.provider': 'ollama',
      'llm.model': 'broken-model'
    });

    await rememberTestedModel(db, 'ollama', 'qwen3:latest');
    await rememberTestedModel(db, 'ollama', 'qwen3:latest');
    await rememberTestedModel(db, 'ollama', 'deepseek-v3.2:cloud');
    await rememberLastWorkingModel(db, 'ollama', 'qwen3:latest');

    const effective = await getEffectiveLlmSelection(db);
    assert.equal(effective.provider, 'ollama', 'Expected effective provider to prefer the last workable provider');
    assert.equal(effective.model, 'qwen3:latest', 'Expected effective model to prefer the last workable model');
    assert.equal(effective.source, 'last-working', 'Expected effective selection to report last-working source');

    const models = await getKnownModelsForProvider(db, 'ollama', ['llama3', 'qwen3:latest']);
    assert.deepEqual(
      models,
      ['llama3', 'qwen3:latest', 'deepseek-v3.2:cloud', 'broken-model'],
      'Expected known-model list to merge discovered, tested, last workable, and configured selections without duplicates'
    );

    await saveActiveSelection(db, 'ollama', 'deepseek-v3.2:cloud');
    assert.equal(await db.getSetting('llm.provider'), 'ollama', 'Expected saveActiveSelection() to persist active provider');
    assert.equal(await db.getSetting('llm.model'), 'deepseek-v3.2:cloud', 'Expected saveActiveSelection() to persist active model');
    assert.equal(await db.getSetting('llm.modelType'), 'cloud', 'Expected Ollama cloud-like models to update llm.modelType');
  }
};
