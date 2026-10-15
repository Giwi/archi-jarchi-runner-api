import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseBoolean, parsePositiveInt, parseString } from '../src/config.js';

describe('config parsing helpers', () => {
  test('parseString reads env and falls back', () => {
    delete process.env.TEST_STR;
    assert.equal(parseString('TEST_STR', 'fallback'), 'fallback');

    process.env.TEST_STR = '';
    assert.equal(parseString('TEST_STR', 'fallback'), 'fallback');

    process.env.TEST_STR = 'value';
    assert.equal(parseString('TEST_STR', 'fallback'), 'value');

    delete process.env.TEST_STR;
  });

  test('parsePositiveInt reads env and falls back', () => {
    delete process.env.TEST_INT;
    assert.equal(parsePositiveInt('TEST_INT', 42), 42);

    process.env.TEST_INT = '7';
    assert.equal(parsePositiveInt('TEST_INT', 42), 7);

    delete process.env.TEST_INT;
  });

  test('parsePositiveInt rejects invalid values', () => {
    process.env.TEST_INT = '0';
    assert.throws(() => parsePositiveInt('TEST_INT', 42), /positive integer/);

    process.env.TEST_INT = '-1';
    assert.throws(() => parsePositiveInt('TEST_INT', 42), /positive integer/);

    process.env.TEST_INT = 'abc';
    assert.throws(() => parsePositiveInt('TEST_INT', 42), /positive integer/);

    process.env.TEST_INT = '3000abc';
    assert.throws(() => parsePositiveInt('TEST_INT', 42), /positive integer/);

    process.env.TEST_INT = '1.5';
    assert.throws(() => parsePositiveInt('TEST_INT', 42), /positive integer/);

    process.env.TEST_INT = '0x10';
    assert.throws(() => parsePositiveInt('TEST_INT', 42), /positive integer/);

    delete process.env.TEST_INT;
  });

  test('parseBoolean reads env and falls back', () => {
    delete process.env.TEST_BOOL;
    assert.equal(parseBoolean('TEST_BOOL', false), false);
    assert.equal(parseBoolean('TEST_BOOL', true), true);

    process.env.TEST_BOOL = 'true';
    assert.equal(parseBoolean('TEST_BOOL', false), true);

    process.env.TEST_BOOL = 'TRUE';
    assert.equal(parseBoolean('TEST_BOOL', false), true);

    process.env.TEST_BOOL = 'false';
    assert.equal(parseBoolean('TEST_BOOL', true), false);

    delete process.env.TEST_BOOL;
  });
});
