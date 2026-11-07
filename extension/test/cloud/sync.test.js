import assert from 'node:assert/strict';
import test from 'node:test';
import { createSync, safeCloudData } from '../../src/cloud/sync.js';
import { eventually, fakeStore, memoryKv } from './helpers.js';

test('safeCloudData：不把 key、token、截圖或 data 圖片送往雲端', () => {
  const clean = safeCloudData({
    apiKey: 'secret',
    access_token: 'token',
    nested: { authorization: 'Bearer secret', text: '保留' },
    screenshot: 'removed',
    image: { mediaType: 'image/png', data: 'abc' },
    selection: 'data:image/png;base64,abc',
    inputTokens: 31,
  });
  assert.deepEqual(clean, { nested: { text: '保留' }, inputTokens: 31 });
});

test('同步：離線時持久化排隊，重新 online 後以清理過的資料補傳', async (t) => {
  const kv = memoryKv();
  const sent = [];
  const cloudListeners = new Set();
  let online = false;
  const cloud = {
    storage: kv,
    getDevice: () => ({ id: 'device-1' }),
    subscribe(listener) {
      cloudListeners.add(listener);
      return () => cloudListeners.delete(listener);
    },
    async putProject(project) {
      sent.push({ type: 'project', value: project });
      if (!online) throw new Error('offline');
    },
    async putRun(run) {
      sent.push({ type: 'run', value: run });
      if (!online) throw new Error('offline');
    },
    async postRunEvents(runId, events) {
      sent.push({ type: 'events', runId, value: events });
      if (!online) throw new Error('offline');
    },
    async putArtifact(runId, artifact) {
      sent.push({ type: 'artifact', runId, value: artifact });
      if (!online) throw new Error('offline');
    },
  };
  const run = {
    id: 'run-1',
    projectId: 'project-local',
    status: 'running',
    apiKey: 'must-not-leak',
    context: [{ type: 'region', image: 'data:image/png;base64,abc' }],
    tasks: [{ id: 'task-1', result: '保留', secret: 'must-not-leak', sources: [] }],
    artifacts: [{ id: 'artifact-1', screenshot: 'removed', content: 'safe artifact' }],
  };
  let onEngineEvent = null;
  const engine = {
    async getRun(id) { return id === 'run-1' ? structuredClone(run) : null; },
    subscribe(listener) {
      onEngineEvent = listener;
      return () => { onEngineEvent = null; };
    },
  };
  const sync = createSync({ cloud, engine, store: fakeStore() });
  t.after(() => sync.stop());
  await sync.ready;

  onEngineEvent({ seq: 1, runId: 'run-1', type: 'artifact', payload: { artifactId: 'artifact-1' } });
  await eventually(() => assert.equal(sync.getQueue().length, 4));
  assert.ok(sent.length >= 4, '離線時仍會嘗試傳送，失敗後保留佇列');
  const attempted = JSON.stringify(sent);
  assert.equal(attempted.includes('must-not-leak'), false);
  assert.equal(attempted.includes('data:image/png;base64,abc'), false);
  assert.equal(attempted.includes('"screenshot"'), false);

  online = true;
  for (const listener of cloudListeners) listener({ type: 'status', status: 'online' });
  await eventually(() => assert.equal(sync.getQueue().length, 0));

  const uploadedRun = [...sent].reverse().find((item) => item.type === 'run').value;
  assert.equal(uploadedRun.context, undefined);
  assert.equal(uploadedRun.apiKey, undefined);
  assert.equal(uploadedRun.tasks[0].secret, undefined);
  assert.equal(uploadedRun.deviceId, 'device-1');
  const uploadedArtifact = [...sent].reverse().find((item) => item.type === 'artifact').value;
  assert.equal(uploadedArtifact.screenshot, undefined);
});

test('同步：第一次上傳專案時任務已結束，最後送出的快照仍是最新狀態', async (t) => {
  const order = [];
  let releaseProject;
  const projectGate = new Promise((resolve) => { releaseProject = resolve; });
  const cloud = {
    subscribe: () => () => {},
    getDevice: () => ({ id: 'device-1' }),
    async putProject() { order.push('project'); await projectGate; },
    async putRun(run) { order.push(`run:${run.status}`); },
    async postRunEvents() {},
  };
  const run = { id: 'run-1', projectId: 'project-1', goal: '目標', status: 'planning', tasks: [] };
  let onEngineEvent = null;
  const engine = {
    async getRun() { return structuredClone(run); },
    subscribe(listener) { onEngineEvent = listener; return () => {}; },
  };
  const store = { ...fakeStore(), async listProjects() { return [{ id: 'project-1', name: '專案' }]; } };
  const sync = createSync({ cloud, engine, store, kv: memoryKv() });
  t.after(() => sync.stop());
  await sync.ready;

  onEngineEvent({ seq: 1, runId: 'run-1', type: 'usage', payload: {} });
  await eventually(() => assert.deepEqual(order, ['project']));
  run.status = 'done';
  onEngineEvent({ seq: 2, runId: 'run-1', type: 'run_finished', payload: { status: 'done' } });
  releaseProject();

  await eventually(() => assert.equal(sync.getQueue().length, 0));
  await eventually(() => assert.equal(order.length, 3));
  assert.deepEqual(order, ['project', 'run:done', 'run:done'], '專案先建好，任務快照不可回到舊狀態');
});
