const ServiceContainer = require('../../src/main/service-container');

module.exports = {
  name: 'service-container-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const container = new ServiceContainer();
    const alpha = { value: 1 };
    const beta = { value: 2 };

    container.register('alpha', alpha);
    assert.equal(container.get('alpha'), alpha, 'Expected registered service to be retrievable');
    assert.deepEqual(container.keys(), ['alpha'], 'Expected keys() to list registered services');

    let duplicateError = null;
    try {
      container.register('alpha', beta);
    } catch (error) {
      duplicateError = error;
    }

    assert.ok(duplicateError, 'Expected duplicate registration to throw');
    assert.includes(duplicateError.message, 'already registered', 'Expected duplicate registration error message');

    container.replace('alpha', beta);
    assert.equal(container.get('alpha'), beta, 'Expected replace() to overwrite the existing service');

    container.register('flag', false);
    container.register('count', 0);
    assert.equal(container.get('flag'), false, 'Expected get() to return registered boolean false values');
    assert.equal(container.optional('count'), 0, 'Expected optional() to preserve registered numeric zero values');
    assert.equal(container.optional('missing'), null, 'Expected optional() to return null only for missing services');
  }
};
