import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';

const activeContexts = new Set();

afterEach(async () => {
  for (const context of activeContexts) await close(context);
  activeContexts.clear();
});

async function start(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cuemesh-server-test-'));
  const database = createDatabase(join(directory, 'cuemesh.sqlite'));
  let clock = options.now ?? 1_750_000_000_000;
  const app = createApp({
    database,
    now: () => clock,
    websiteOrigins: options.websiteOrigins,
    rateLimits: options.rateLimits,
  });
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const context = {
    app,
    database,
    directory,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    advance(milliseconds) { clock += milliseconds; },
  };
  activeContexts.add(context);
  return context;
}

async function close(context) {
  if (!context.server.listening) return;
  context.app.locals.close();
  await new Promise((resolve) => context.server.close(resolve));
  context.database.close();
  await rm(context.directory, { recursive: true, force: true });
}

async function api(context, path, { method = 'GET', token, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${context.baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  return { response, status: response.status, body: json, text };
}

async function register(context, email, displayName) {
  const result = await api(context, '/api/auth/register', {
    method: 'POST', body: { email, password: 'correct horse battery', displayName },
  });
  assert.equal(result.status, 201, result.text);
  return { ...result.body, password: 'correct horse battery' };
}

async function putDevice(context, account, id, acceptRemote = undefined) {
  const result = await api(context, `/api/devices/${id}`, {
    method: 'PUT', token: account.token, body: { name: id, platform: 'test' },
  });
  assert.equal(result.status, 200, result.text);
  if (acceptRemote) {
    const patched = await api(context, `/api/devices/${id}`, {
      method: 'PATCH', token: account.token, body: { acceptRemote },
    });
    assert.equal(patched.status, 200, patched.text);
  }
  return result.body.device;
}

async function createProject(context, account, id = 'project-a') {
  const result = await api(context, `/api/projects/${id}`, {
    method: 'PUT', token: account.token, body: { name: '測試專案', description: '共享測試' },
  });
  assert.equal(result.status, 200, result.text);
  return result.body.project;
}

async function addMember(context, owner, member, projectId) {
  const invite = await api(context, `/api/projects/${projectId}/invites`, { method: 'POST', token: owner.token, body: {} });
  assert.equal(invite.status, 201, invite.text);
  const accepted = await api(context, '/api/invites/accept', { method: 'POST', token: member.token, body: { code: invite.body.code } });
  assert.equal(accepted.status, 200, accepted.text);
}

async function createRun(context, account, { id, projectId, deviceId, status = 'running' }) {
  const result = await api(context, `/api/runs/${id}`, {
    method: 'PUT', token: account.token,
    body: {
      id, projectId, deviceId, goal: '測試任務', status, mode: 'auto', planSummary: '', tasks: [],
      createdAt: 1_750_000_000_000,
    },
  });
  assert.equal(result.status, 200, result.text);
  return result.body.run;
}

async function createDispatch(context, sender, body) {
  return api(context, '/api/dispatches', { method: 'POST', token: sender.token, body });
}

async function sharedFixture(context) {
  const alice = await register(context, 'alice@example.test', 'Alice');
  const bob = await register(context, 'bob@example.test', 'Bob');
  const carol = await register(context, 'carol@example.test', 'Carol');
  await putDevice(context, alice, 'alice-device');
  await putDevice(context, bob, 'bob-device');
  await putDevice(context, carol, 'carol-device');
  const project = await createProject(context, alice);
  await addMember(context, alice, bob, project.id);
  return { alice, bob, carol, project };
}

function dispatchBody(id, projectId, targetDeviceId, extras = {}) {
  return {
    id,
    projectId,
    targetDeviceId,
    senderDeviceId: 'alice-device',
    goal: '請研究這個功能',
    context: [{ type: 'selection', text: '測試', url: 'https://example.test', title: '測試' }],
    options: { maxCostUsd: 1 },
    parent: { runId: 'parent-run', taskId: 'task-1' },
    ...extras,
  };
}

function parseFrames(text) {
  return text.split('\n\n').filter(Boolean).map((frame) => {
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    return data ? JSON.parse(data) : null;
  }).filter(Boolean);
}

async function readSseUntil(reader, predicate, timeoutMs = 2_000) {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const left = Math.max(1, deadline - Date.now());
    const next = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('等待 SSE 事件逾時')), left)),
    ]);
    if (next.done) throw new Error('SSE 在收到預期事件前關閉');
    buffer += decoder.decode(next.value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const event of parseFrames(parts.join('\n\n'))) {
      if (predicate(event)) return event;
    }
  }
  throw new Error('等待 SSE 事件逾時');
}

test('帳號驗證只儲存雜湊，登入失敗不洩漏 Email 是否存在', async () => {
  const context = await start({ rateLimits: { authMax: 10 } });
  const alice = await register(context, 'alice@example.test', 'Alice');
  const stored = context.database.prepare('SELECT password_hash FROM users WHERE id = ?').get(alice.user.id);
  const token = context.database.prepare('SELECT token_hash FROM auth_tokens WHERE user_id = ?').get(alice.user.id);
  assert.ok(!stored.password_hash.includes(alice.password));
  assert.notEqual(token.token_hash, alice.token);

  const unknown = await api(context, '/api/auth/login', { method: 'POST', body: { email: 'none@example.test', password: 'wrong password' } });
  const wrong = await api(context, '/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'wrong password' } });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
  const logout = await api(context, '/api/auth/logout', { method: 'POST', token: alice.token });
  assert.equal(logout.status, 204);
  assert.equal((await api(context, '/api/me', { token: alice.token })).status, 401);
});

test('跨帳號資源一律不可讀寫且 404 不洩漏存在性', async () => {
  const context = await start();
  const { alice, bob, carol, project } = await sharedFixture(context);
  await createRun(context, alice, { id: 'run-a', projectId: project.id, deviceId: 'alice-device' });

  const known = await api(context, '/api/runs/run-a', { token: carol.token });
  const missing = await api(context, '/api/runs/missing-run', { token: carol.token });
  assert.equal(known.status, 404);
  assert.deepEqual(known.body, missing.body);
  assert.equal((await api(context, `/api/projects/${project.id}/members`, { token: carol.token })).status, 404);
  assert.equal((await api(context, '/api/devices/alice-device', { method: 'PATCH', token: carol.token, body: { name: '偷走' } })).status, 404);
  assert.equal((await api(context, '/api/runs/run-a', {
    method: 'PUT', token: carol.token,
    body: { projectId: project.id, goal: '竄改', status: 'done', mode: 'auto', planSummary: '', tasks: [] },
  })).status, 404);
  assert.equal((await api(context, '/api/projects', { token: bob.token })).status, 200);
});

test('非成員不能派工到其他帳號裝置，伺服器忽略偽造 sender 欄位', async () => {
  const context = await start();
  const { alice, bob, carol, project } = await sharedFixture(context);
  const forbiddenDispatch = await createDispatch(context, carol, dispatchBody('bad-dispatch', project.id, 'bob-device', { senderDeviceId: 'carol-device' }));
  assert.equal(forbiddenDispatch.status, 404);

  const created = await createDispatch(context, alice, dispatchBody('dispatch-a', project.id, 'bob-device', {
    senderName: '假名字', senderUserId: carol.user.id, targetUserId: carol.user.id, crossAccount: false,
  }));
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.dispatch.senderName, 'Alice');
  assert.equal(created.body.dispatch.senderUserId, alice.user.id);
  assert.equal(created.body.dispatch.targetUserId, bob.user.id);
  assert.equal(created.body.dispatch.crossAccount, true);
});

test('派工狀態機拒絕非法轉換，目標裝置可完成合法流程', async () => {
  const context = await start();
  const { alice, bob, project } = await sharedFixture(context);
  const created = await createDispatch(context, alice, dispatchBody('dispatch-state', project.id, 'bob-device'));
  assert.equal(created.status, 201);
  assert.equal((await api(context, '/api/dispatches/dispatch-state/accept', { method: 'POST', token: alice.token, body: { runId: 'run-b' } })).status, 404);
  assert.equal((await api(context, '/api/dispatches/dispatch-state/report', { method: 'POST', token: bob.token, body: { status: 'done', runId: 'run-b', summary: 'x', result: 'x' } })).status, 409);
  const accepted = await api(context, '/api/dispatches/dispatch-state/accept', { method: 'POST', token: bob.token, body: { runId: 'run-b' } });
  assert.equal(accepted.status, 200);
  await createRun(context, bob, { id: 'run-b', projectId: project.id, deviceId: 'bob-device' });
  const reported = await api(context, '/api/dispatches/dispatch-state/report', {
    method: 'POST', token: bob.token, body: { status: 'done', runId: 'run-b', summary: '完成', result: '結果', sources: [] },
  });
  assert.equal(reported.status, 200);
  assert.equal(reported.body.dispatch.status, 'done');
  const cancelled = await api(context, '/api/dispatches/dispatch-state/cancel', { method: 'POST', token: alice.token, body: {} });
  assert.equal(cancelled.status, 409);
});

test('移除成員立即撤銷存取並取消 pending 與 accepted 派工', async () => {
  const context = await start();
  const { alice, bob, project } = await sharedFixture(context);
  assert.equal((await createDispatch(context, alice, dispatchBody('dispatch-pending', project.id, 'bob-device'))).status, 201);
  assert.equal((await createDispatch(context, alice, dispatchBody('dispatch-accepted', project.id, 'bob-device'))).status, 201);
  assert.equal((await api(context, '/api/dispatches/dispatch-accepted/accept', { method: 'POST', token: bob.token, body: { runId: 'run-b' } })).status, 200);

  const removed = await api(context, `/api/projects/${project.id}/members/${bob.user.id}`, { method: 'DELETE', token: alice.token });
  assert.equal(removed.status, 204);
  assert.equal((await api(context, '/api/dispatches/dispatch-pending', { token: bob.token })).status, 404);
  assert.equal((await api(context, '/api/dispatches/dispatch-accepted/report', {
    method: 'POST', token: bob.token, body: { status: 'failed', runId: 'run-b', summary: 'x', result: 'x' },
  })).status, 404);
  const pending = await api(context, '/api/dispatches/dispatch-pending', { token: alice.token });
  const accepted = await api(context, '/api/dispatches/dispatch-accepted', { token: alice.token });
  assert.equal(pending.body.dispatch.status, 'cancelled');
  assert.equal(accepted.body.dispatch.status, 'cancelled');
});

test('保險箱版本衝突、Run 事件去重與敏感欄位拒絕', async () => {
  const context = await start();
  const alice = await register(context, 'alice@example.test', 'Alice');
  const vault = {
    expectedVersion: 0,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 },
    salt: 'YQ==', iv: 'Yg==', ciphertext: 'Yw==',
  };
  assert.equal((await api(context, '/api/vault', { method: 'PUT', token: alice.token, body: vault })).status, 200);
  const conflict = await api(context, '/api/vault', { method: 'PUT', token: alice.token, body: { ...vault, ciphertext: 'ZA==' } });
  assert.equal(conflict.status, 409);

  await putDevice(context, alice, 'alice-device');
  const project = await createProject(context, alice);
  await createRun(context, alice, { id: 'run-events', projectId: project.id, deviceId: 'alice-device' });
  const event = { seq: 1, runId: 'run-events', type: 'tool_call', payload: { tool: 'x', args: { query: 'private' } }, createdAt: 1 };
  assert.equal((await api(context, '/api/runs/run-events/events', { method: 'POST', token: alice.token, body: { events: [event] } })).body.accepted, 1);
  assert.equal((await api(context, '/api/runs/run-events/events', { method: 'POST', token: alice.token, body: { events: [{ ...event, payload: { changed: true } }] } })).body.accepted, 0);
  const full = await api(context, '/api/runs/run-events', { token: alice.token });
  assert.equal(full.body.run.events.length, 1);
  const sensitive = await api(context, '/api/runs/run-events', {
    method: 'PUT', token: alice.token,
    body: { projectId: project.id, deviceId: 'alice-device', goal: 'x', status: 'running', mode: 'auto', planSummary: '', tasks: [], apiKey: 'nope' },
  });
  assert.equal(sensitive.status, 400);
});

test('pending 派工到期後不能接受，payload 上限回契約錯誤', async () => {
  const context = await start();
  const { alice, bob, project } = await sharedFixture(context);
  const created = await createDispatch(context, alice, dispatchBody('dispatch-expire', project.id, 'bob-device'));
  assert.equal(created.status, 201);
  context.advance(10 * 60 * 1000 + 1);
  const expired = await api(context, '/api/dispatches/dispatch-expire/accept', { method: 'POST', token: bob.token, body: { runId: 'run-b' } });
  assert.equal(expired.status, 409);
  const current = await api(context, '/api/dispatches/dispatch-expire', { token: alice.token });
  assert.equal(current.body.dispatch.status, 'expired');
  const tooLarge = await createDispatch(context, alice, dispatchBody('dispatch-large', project.id, 'bob-device', { goal: '字'.repeat(7_000) }));
  assert.equal(tooLarge.status, 413);
});

test('SSE 有 presence、只送目標、可依 since 補送', async () => {
  const context = await start();
  const { alice, bob, project } = await sharedFixture(context);
  const aStream = await fetch(`${context.baseUrl}/api/stream?deviceId=alice-device`, { headers: { Authorization: `Bearer ${alice.token}` } });
  assert.equal(aStream.status, 200);
  const aReader = aStream.body.getReader();
  const bStream = await fetch(`${context.baseUrl}/api/stream?deviceId=bob-device`, { headers: { Authorization: `Bearer ${bob.token}` } });
  assert.equal(bStream.headers.get('content-type')?.startsWith('text/event-stream'), true);
  assert.equal(bStream.headers.get('x-accel-buffering'), 'no');
  const presence = await readSseUntil(aReader, (event) => event.type === 'device_presence' && event.payload.deviceId === 'bob-device' && event.payload.online === true);
  assert.equal(presence.payload.online, true);

  const bReader = bStream.body.getReader();
  const created = await createDispatch(context, alice, dispatchBody('dispatch-sse', project.id, 'bob-device'));
  assert.equal(created.status, 201);
  const createdEvent = await readSseUntil(bReader, (event) => event.type === 'dispatch_created' && event.payload.dispatch.id === 'dispatch-sse');
  await bReader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await api(context, '/api/dispatches/dispatch-sse/cancel', { method: 'POST', token: alice.token, body: {} })).status, 200);

  const replay = await fetch(`${context.baseUrl}/api/stream?deviceId=bob-device&since=${createdEvent.seq}`, { headers: { Authorization: `Bearer ${bob.token}` } });
  const replayReader = replay.body.getReader();
  const update = await readSseUntil(replayReader, (event) => event.type === 'dispatch_update' && event.payload.dispatch.id === 'dispatch-sse');
  assert.equal(update.payload.dispatch.status, 'cancelled');
  await replayReader.cancel();
  await aReader.cancel();
});

test('派工與 auth 限流、CORS 精確來源都可驗證', async () => {
  const context = await start({ websiteOrigins: 'https://app.cuemesh.test', rateLimits: { authMax: 3, dispatchMax: 30 } });
  const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const preflight = await api(context, '/api/me', {
    method: 'OPTIONS', headers: { Origin: extensionOrigin, 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.response.headers.get('access-control-allow-origin'), extensionOrigin);
  const website = await api(context, '/api/me', { headers: { Origin: 'https://app.cuemesh.test' } });
  assert.equal(website.response.headers.get('access-control-allow-origin'), 'https://app.cuemesh.test');
  const blocked = await api(context, '/api/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(blocked.status, 403);

  const { alice, project } = await (async () => {
    const alice = await register(context, 'alice@example.test', 'Alice');
    await putDevice(context, alice, 'alice-device');
    const project = await createProject(context, alice);
    return { alice, project };
  })();
  for (let index = 0; index < 30; index += 1) {
    const result = await createDispatch(context, alice, dispatchBody(`rate-${index}`, project.id, 'alice-device'));
    assert.equal(result.status, 201, result.text);
  }
  const limited = await createDispatch(context, alice, dispatchBody('rate-over', project.id, 'alice-device'));
  assert.equal(limited.status, 429);

  await register(context, 'rate-b@example.test', 'Rate B');
  await register(context, 'rate-c@example.test', 'Rate C');
  const authLimited = await api(context, '/api/auth/register', {
    method: 'POST', body: { email: 'rate-over@example.test', password: 'correct horse battery', displayName: 'Rate Over' },
  });
  assert.equal(authLimited.status, 429);
});
