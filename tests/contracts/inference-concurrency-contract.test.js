const InferenceDispatcher = require('../../src/main/inference-dispatcher');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDb(globalEnabled = false) {
  return {
    async getSetting(key) {
      if (key === 'llm.concurrency.enabled') {
        return globalEnabled ? 'true' : 'false';
      }
      return null;
    }
  };
}

module.exports = {
  name: 'inference-concurrency-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const callLog = [];
    let active = 0;
    let maxActive = 0;
    const aiService = {
      getCurrentProvider() {
        return 'ollama';
      },
      async sendMessage(messages, options = {}) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        callLog.push({ provider: options.provider, startedAt: Date.now() });
        await sleep(20);
        active -= 1;
        return { content: 'ok', model: options.model || 'test-model', usage: {} };
      },
      systemPrompt: 'test'
    };

    const spec = {
      model: 'test-model',
      capabilities: {
        concurrency: {
          supported: true
        }
      }
    };

    const dispatcherQueued = new InferenceDispatcher(aiService, createDb(false), null);
    const queuedResponses = await Promise.all([
      dispatcherQueued.dispatch('a', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'openai',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: true } },
        concurrencyMode: 'queued'
      }),
      dispatcherQueued.dispatch('b', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'groq',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: true } },
        concurrencyMode: 'queued'
      })
    ]);
    assert.equal(maxActive, 1, 'Queued mode should serialize globally');
    assert.equal(queuedResponses[0].concurrency?.needs_enablement, false, 'Queued mode should not require enablement');

    const disabledParallel = await dispatcherQueued.dispatch('p', [], {
      mode: 'connector',
      model: 'test-model',
      provider: 'openai',
      includeTools: false,
      includeRules: false,
      includeEnv: false,
      thinkingMode: 'off',
      modelSpec: spec,
      runtimeConfig: { concurrency: { allowParallel: true } },
      concurrencyMode: 'parallel'
    });
    assert.equal(disabledParallel.concurrency?.needs_enablement, true, 'Parallel mode should surface enablement requirement when global toggle is off');

    active = 0;
    maxActive = 0;
    callLog.length = 0;
    const dispatcherParallel = new InferenceDispatcher(aiService, createDb(true), null);
    await Promise.all([
      dispatcherParallel.dispatch('a', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'openai',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: false } },
        concurrencyMode: 'parallel'
      }),
      dispatcherParallel.dispatch('b', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'groq',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: false } },
        concurrencyMode: 'parallel'
      })
    ]);
    assert.equal(maxActive, 2, 'Different providers should run in parallel when global concurrency is enabled');

    active = 0;
    maxActive = 0;
    await Promise.all([
      dispatcherParallel.dispatch('a', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'openai',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: false } },
        concurrencyMode: 'parallel'
      }),
      dispatcherParallel.dispatch('b', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'openai',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: false } },
        concurrencyMode: 'parallel'
      })
    ]);
    assert.equal(maxActive, 1, 'Same provider should queue when allowParallel is false');

    active = 0;
    maxActive = 0;
    await Promise.all([
      dispatcherParallel.dispatch('a', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'openai',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: true } },
        concurrencyMode: 'parallel'
      }),
      dispatcherParallel.dispatch('b', [], {
        mode: 'connector',
        model: 'test-model',
        provider: 'openai',
        includeTools: false,
        includeRules: false,
        includeEnv: false,
        thinkingMode: 'off',
        modelSpec: spec,
        runtimeConfig: { concurrency: { allowParallel: true } },
        concurrencyMode: 'parallel'
      })
    ]);
    assert.equal(maxActive, 2, 'Same provider should run in parallel when allowParallel is true');
  }
};
