import assert from 'node:assert/strict';
import test from 'node:test';
import { createMesh } from '../../src/cloud/mesh.js';
import { createRemoteRunner, safeDispatchContext } from '../../src/cloud/remote.js';
import { createSync } from '../../src/cloud/sync.js';
import { createStore, memoryKv } from '../../src/core/store.js';

function fakeCloud(overrides = {}) {
  const listeners = new Set();
  const calls = [];
  const dispatches = new Map();
  const cloud = {
    calls, dispatches,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    fire(event) { for (const fn of listeners) fn(event); },
    getDevice: () => ({ id: 'me', acceptRemote: 'auto' }),
    async getDispatch(id) { return { dispatch: dispatches.get(id), messages: [] }; },
    async listDispatches() { return []; },
    async listDevices() { return []; },
    async listProjects() { return [{ id: 'cloud-project', name: '共享專案' }]; },
    async putProject(p) { calls.push(['putProject', p.id]); return p; },
    async putRun(r) { calls.push(['putRun', r.id, r.status]); return r; },
    async postRunEvents() {},
    async acceptDispatch(id, { runId }) { calls.push(['accept', id, runId]); },
    async rejectDispatch(id) { calls.push(['reject', id]); },
    async reportDispatch(id, report) { calls.push(['report', id, report.status]); },
    async cancelDispatch(id) { calls.push(['cancel', id]); },
    async sendDispatchMessage(id, m) { calls.push(['message', id, m.kind]); return { id: 'm1', ...m }; },
    async dispatch(d) { calls.push(['dispatch', d.targetDeviceId]); return { id: 'x', status: 'done', result: 'ok' }; },
    ...overrides,
  };
  return cloud;
}

function fakeEngine(status = 'done') {
  const runs = new Map();
  return {
    started: [], cancelled: [],
    start(args) { this.started.push(args); const id = `run-${this.started.length}`; runs.set(id, { id, projectId: args.projectId, status, tasks: [], finalResult: '完成' }); return id; },
    async waitForRun() {},
    async getRun(id) { return runs.get(id); },
    cancel(id) { this.cancelled.push(id); },
    subscribe() { return () => {}; },
  };
}

const flushAsync = () => new Promise((r) => setTimeout(r, 15));

test('提問事件只由發起派工的裝置回答，子 agent 那台不會自問自答', async () => {
  const cloud = fakeCloud();
  const mesh = createMesh({ cloud, pollMs: 100000 });
  const heard = [];
  mesh.onQuestion((q) => heard.push(q));
  const message = (over) => ({ id: over.id, dispatchId: 'd1', kind: 'question', text: '問題', ...over });

  cloud.dispatches.set('d1', { id: 'd1', senderDeviceId: 'other', parent: { runId: 'r' }, status: 'accepted' });
  cloud.fire({ type: 'dispatch_message', payload: { message: message({ id: 'q1', fromDeviceId: 'me' }) } });
  cloud.fire({ type: 'dispatch_message', payload: { message: message({ id: 'q2', fromDeviceId: 'third' }) } });
  await flushAsync();
  assert.equal(heard.length, 0, '發起者不是我時都不可回答');

  cloud.dispatches.set('d1', { id: 'd1', senderDeviceId: 'me', parent: { runId: 'r' }, status: 'accepted' });
  cloud.fire({ type: 'dispatch_message', payload: { message: message({ id: 'q3', fromDeviceId: 'target' }) } });
  await flushAsync();
  assert.equal(heard.length, 1);
  assert.equal(heard[0].messageId, 'q3');
  mesh.stop();
});

test('派工前先把專案送到伺服器；成員被拒不影響派工', async () => {
  const store = await createStore({ kv: memoryKv() });
  const project = await store.createProject({ name: 'p' });
  const cloud = fakeCloud({ async putProject() { const e = new Error('403'); e.status = 403; throw e; } });
  const mesh = createMesh({ cloud, store, pollMs: 100000 });
  const out = await mesh.dispatch({ targetDeviceId: 't', projectId: project.id, goal: 'g' });
  assert.equal(out.status, 'done');
  mesh.stop();
});

test('對方傳來的 tabId 與圖片一律捨棄，只留文字情境', () => {
  const clean = safeDispatchContext([
    { type: 'selection', text: '文字', url: 'https://a.test', title: 't', tabId: 7, image: { mediaType: 'image/png', data: 'AAAA' } },
    { type: 'region', tabId: 9, image: { mediaType: 'image/png', data: 'BBBB' } },
    null, 'x',
  ]);
  assert.deepEqual(clean, [{ type: 'selection', text: '文字', url: 'https://a.test', title: 't' }]);
  assert.deepEqual(safeDispatchContext('nope'), []);
});

test('接受派工：用雲端專案 id，惡意 tabId 不會傳給引擎，且先上傳任務才回報', async () => {
  const store = await createStore({ kv: memoryKv() });
  const dispatch = { id: 'd1', projectId: 'cloud-project', status: 'pending', crossAccount: false, goal: 'g', senderName: 'A', options: {},
    context: [{ type: 'selection', text: 't', tabId: 5 }] };
  const cloud = fakeCloud();
  cloud.dispatches.set('d1', dispatch);
  const engine = fakeEngine('done');
  const runner = createRemoteRunner({ cloud, engine, store });
  await runner.handleDispatch(dispatch);
  await flushAsync();
  assert.equal(engine.started[0].projectId, 'cloud-project');
  assert.equal(Number.isInteger(engine.started[0].context[0].tabId), false);
  assert.equal((await store.listProjects())[0].name, '共享專案');
  const names = cloud.calls.map((c) => c[0]);
  assert.ok(names.indexOf('putRun') < names.indexOf('report'), names.join());
  runner.stop();
});

test('這台自己取消任務時走取消流程，不送伺服器不接受的 cancelled 回報', async () => {
  const store = await createStore({ kv: memoryKv() });
  const dispatch = { id: 'd2', projectId: 'cloud-project', status: 'pending', crossAccount: false, goal: 'g', options: {} };
  const cloud = fakeCloud();
  cloud.dispatches.set('d2', dispatch);
  const runner = createRemoteRunner({ cloud, engine: fakeEngine('cancelled'), store });
  await runner.handleDispatch(dispatch);
  await flushAsync();
  assert.ok(cloud.calls.some((c) => c[0] === 'cancel'));
  assert.ok(!cloud.calls.some((c) => c[0] === 'report'));
  runner.stop();
});

test('登入或重連後補回錯過的派工', async () => {
  const store = await createStore({ kv: memoryKv() });
  let lists = 0;
  const cloud = fakeCloud({ async listDispatches() { lists += 1; return []; } });
  const runner = createRemoteRunner({ cloud, engine: fakeEngine(), store });
  await flushAsync();
  const before = lists;
  cloud.fire({ type: 'status', status: 'online' });
  await flushAsync();
  assert.equal(lists, before + 1);
  runner.stop();
});

test('同步：成員被拒的專案更新不會卡住後面的任務；暫時性錯誤仍保留重送', async () => {
  const sent = [];
  const cloud = fakeCloud({
    storage: memoryKv(),
    async putProject() { const e = new Error('forbidden'); e.status = 403; throw e; },
    async putRun(r) { sent.push(r.id); },
  });
  const store = await createStore({ kv: memoryKv() });
  const project = await store.createProject({ name: 'p' });
  let fire;
  const engine = { subscribe(fn) { fire = fn; return () => {}; }, async getRun(id) { return { id, projectId: project.id, status: 'running', tasks: [] }; } };
  const sync = createSync({ cloud, engine, store });
  await sync.ready;
  fire({ seq: 1, runId: 'r1', type: 'run_update', payload: {} });
  await flushAsync();
  assert.deepEqual(sent, ['r1']);

  cloud.putRun = async () => { const e = new Error('down'); e.status = 503; throw e; };
  fire({ seq: 2, runId: 'r2', type: 'run_update', payload: {} });
  await flushAsync();
  assert.ok(sync.getQueue().some((item) => item.type === 'run'));
  sync.stop();
});

test('store：ensureProject 用指定 id 且可重複呼叫；exportKeys 只含支援的服務', async () => {
  const store = await createStore({ kv: memoryKv() });
  await store.setKey('openai', 'k1');
  const first = await store.ensureProject({ id: 'abc', name: '共享' });
  const again = await store.ensureProject({ id: 'abc', name: '別的名字' });
  assert.equal(first.id, 'abc');
  assert.equal(again.name, '共享');
  assert.deepEqual(await store.exportKeys(), { anthropic: null, openai: 'k1' });
});
