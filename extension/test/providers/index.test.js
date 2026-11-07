import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviders } from '../../src/providers/index.js';

test('供應商工廠建立三個統一介面', () => {
  const providers = createProviders({
    baseURLs: {
      anthropic: 'http://127.0.0.1:1/anthropic',
      openai: 'http://127.0.0.1:1/openai',
    },
  });

  assert.equal(providers.anthropic.name, 'anthropic');
  assert.equal(providers.openai.name, 'openai');
  assert.equal(typeof providers.anthropic.turn, 'function');
  assert.equal(typeof providers.openai.turn, 'function');
});
