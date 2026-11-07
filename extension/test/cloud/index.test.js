import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_CONFIG_KEY, CLOUD_SESSION_KEY, CLOUD_SYNC_QUEUE_KEY, createCloud } from '../../src/cloud/index.js';
import { eventually, fakeStore, jsonResponse, memoryKv, sseResponse } from './helpers.js';

function signedInKv() {
  return memoryKv({
    [CLOUD_CONFIG_KEY]: { baseUrl: 'https://cloud.test' },
    [CLOUD_SESSION_KEY]: {
      token: 'session-token',
      user: { id: 'user-1', displayName: '測試者' },
      deviceId: 'device-1',
      device: { id: 'device-1', name: '本機', acceptRemote: 'ask' },
      lastSeq: 0,
    },
    [CLOUD_SYNC_QUEUE_KEY]: [{ type: 'events', runId: 'old-run', events: [] }],
  });
}

test('SSE：斷線後以 since 重連，補送事件不重複處理', async (t) => {
  const kv = signedInKv();
  const streamUrls = [];
  let attempts = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname !== '/api/stream') throw new Error('意外路徑 ' + parsed.pathname);
    streamUrls.push(parsed);
    attempts += 1;
    if (attempts === 1) {
      return sseResponse([
        'id: 1\nda',
        'ta: {"seq":1,"type":"dispatch_created","payload":{"dispatch":{"id":"remote-1"}}}\n\n',
      ], options.signal);
    }
    return sseResponse([
      'id: 1\ndata: {"seq":1,"type":"dispatch_created","payload":{"dispatch":{"id":"remote-1"}}}\n\n',
      'id: 2\ndata: {"seq":2,"type":"dispatch_update","payload":{"dispatch":{"id":"remote-1","status":"accepted"}}}\n\n',
    ], options.signal, { hold: true });
  };
  const cloud = await createCloud({ kv, fetchImpl, retryBaseMs: 1, retryMaxMs: 1 });
  t.after(() => cloud.disconnect());
  const received = [];
  cloud.subscribe((event) => {
    if (Number.isFinite(event.seq)) received.push(event);
  });

  await eventually(() => {
    assert.deepEqual(received.map((event) => event.seq), [1, 2]);
    assert.equal(streamUrls.length, 2);
  });
  assert.equal(streamUrls[0].searchParams.get('deviceId'), 'device-1');
  assert.equal(streamUrls[0].searchParams.get('since'), '0');
  assert.equal(streamUrls[1].searchParams.get('since'), '1');
  assert.equal(kv.data[CLOUD_SESSION_KEY].lastSeq, 2);
});

test('登出：清除 token 與雲端佇列，但保留本機 key 與專案', async (t) => {
  const kv = signedInKv();
  const store = fakeStore({ anthropic: 'keep-anthropic', openai: 'keep-openai' });
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: options.method });
    if (path === '/api/stream') return sseResponse([], options.signal, { hold: true });
    if (path === '/api/auth/logout') return jsonResponse(null, 204);
    throw new Error('意外路徑 ' + path);
  };
  const cloud = await createCloud({ kv, fetchImpl, store });
  t.after(() => cloud.disconnect());

  await cloud.logout();

  assert.deepEqual(requests.find((request) => request.path === '/api/auth/logout'), { path: '/api/auth/logout', method: 'POST' });
  assert.equal(kv.data[CLOUD_SESSION_KEY], null);
  assert.deepEqual(kv.data[CLOUD_SYNC_QUEUE_KEY], []);
  assert.deepEqual(store._keys, { anthropic: 'keep-anthropic', openai: 'keep-openai' });
  assert.equal(store._projects.length, 1);
  assert.equal(cloud.getUser(), null);
  assert.equal(cloud.getStatus(), 'signed_out');
});
