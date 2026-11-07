import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_CONFIG_KEY, CLOUD_SESSION_KEY, createCloud } from '../../src/cloud/index.js';
import { VAULT_ITERATIONS, VaultError, decryptKeyBundle, encryptKeyBundle } from '../../src/cloud/vault.js';
import { fakeStore, jsonResponse, memoryKv, sseResponse } from './helpers.js';

test('保險箱：PBKDF2 600000 次與 AES-GCM 可往返，且只含兩家 key', async () => {
  const keys = { anthropic: 'anthropic-test-key', openai: 'openai-test-key' };
  const first = await encryptKeyBundle(keys, '正確密語');
  const second = await encryptKeyBundle(keys, '正確密語');

  assert.deepEqual(first.kdf, { name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_ITERATIONS });
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await decryptKeyBundle(first, '正確密語'), keys);
  await assert.rejects(decryptKeyBundle(first, '錯誤密語'), VaultError);
});

test('保險箱：密語錯誤或格式錯誤不覆蓋本機 key', async (t) => {
  let vault = null;
  const kv = memoryKv({
    [CLOUD_CONFIG_KEY]: { baseUrl: 'https://cloud.test' },
    [CLOUD_SESSION_KEY]: {
      token: 'test-token',
      user: { id: 'u1', displayName: '測試者' },
      deviceId: 'd1',
      device: { id: 'd1', name: '本機', acceptRemote: 'ask' },
      lastSeq: 0,
    },
  });
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/stream') return sseResponse([], options.signal, { hold: true });
    if (path === '/api/vault' && options.method === 'GET') return jsonResponse({ vault });
    if (path === '/api/vault' && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      vault = { version: 1, updatedAt: 1, ...body };
      return jsonResponse({ vault });
    }
    throw new Error('意外路徑 ' + path);
  };
  const store = fakeStore({ anthropic: '原本-a', openai: '原本-o' });
  const cloud = await createCloud({ kv, fetchImpl, store, baseUrl: 'https://cloud.test' });
  t.after(() => cloud.disconnect());

  await cloud.vaultPush('正確密語');
  store._keys.anthropic = '本機新-a';
  store._keys.openai = '本機新-o';

  await assert.rejects(cloud.vaultPull('錯誤密語'), (error) => {
    assert.ok(error instanceof VaultError);
    assert.match(error.message, /密語|損毀/);
    return true;
  });
  assert.deepEqual(store._keys, { anthropic: '本機新-a', openai: '本機新-o' });
  assert.equal(store.calls.length, 0);

  vault.ciphertext = 'not-base64';
  await assert.rejects(cloud.vaultPull('正確密語'), VaultError);
  assert.deepEqual(store._keys, { anthropic: '本機新-a', openai: '本機新-o' });
});
