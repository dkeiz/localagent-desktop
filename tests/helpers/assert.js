function fail(message) {
  throw new Error(message);
}

function ok(value, message = 'Expected value to be truthy') {
  if (!value) {
    fail(message);
  }
}

function equal(actual, expected, message = '') {
  if (actual !== expected) {
    fail(message || `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function notEqual(actual, expected, message = '') {
  if (actual === expected) {
    fail(message || `Expected values to differ, both were ${JSON.stringify(actual)}`);
  }
}

function deepEqual(actual, expected, message = '') {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    fail(message || `Expected ${expectedJson}, received ${actualJson}`);
  }
}

function includes(haystack, needle, message = '') {
  if (!haystack.includes(needle)) {
    fail(message || `Expected ${JSON.stringify(haystack)} to include ${JSON.stringify(needle)}`);
  }
}

module.exports = {
  fail,
  ok,
  equal,
  notEqual,
  deepEqual,
  includes
};
