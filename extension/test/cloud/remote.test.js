import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteRunner } from '../../src/cloud/remote.js';
import { eventually, fakeStore } from './helpers.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pendingDispatch(overrides = {}) {
  return {
    id: 'dispatch-1',
    projectId: 'project-local',
    senderName: '遠端使用者',
    goal: '整理資料',
    context: [],
    options: { maxCostUsd: 1 },
    status: 'pending',
    crossAccount: false,
    ...overrides,
  };
}

function fixture({ acceptRemote = 'auto', dispatch = pendingDispatch() } = {}) {
  const listeners = new Set();
  const accepted = [];
  const rejected = [];
  const reports = [];
  const started = [];
  const cancelled = [];
  const finished = deferred();
  const cloud = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    getDevice: () => ({ id: 'device-local', acceptRemote }),
    async getDispatch() {
      return { dispatch: structuredClone(dispatch), messages: [] };
    },
    async acceptDispatch(id, body) {
      accepted.push({ id, body });
    },
    async rejectDispatch(id, reason) {
      rejected.push({ id, reason });
    },
    async reportDispatch(id, report) {
      reports.push({ id, report });
    },
  };
  const engine = {
    start(args) {
      started.push(args);
      return 'run-' + started.length;
    },
    cancel(runId) {
      cancelled.push(runId);
      return true;
    },
    waitForRun() {
      return finished.promise;
    },
    async getRun(runId) {
      return {
        id: runId,
        status: 'done',
        finalResult: '整理完成',
        costUsd: 0.25,
        tasks: [{ sources: [{ title: '資料來源', url: 'https://example.test/source' }] }],
      };
    },
  };
  return { cloud, engine, dispatch, accepted, rejected, reports, started, cancelled, finished };
}

test('遠端派工：跨帳號即使 auto 也必須詢問、強制逐步批准、去重並回報', async (t) => {
  const f = fixture({ dispatch: pendingDispatch({ crossAccount: true }) });
  let consentCalls = 0;
  const forcedRuns = [];
  const runner = createRemoteRunner({
    cloud: f.cloud,
    engine: f.engine,
    store: fakeStore(),
    requestConsent: async (dispatch) => {
      consentCalls += 1;
      assert.equal(dispatch.crossAccount, true);
      return { accepted: true };
    },
    onForcedApproval: async (runId) => forcedRuns.push(runId),
  });
  t.after(() => {
    runner.stop();
    f.finished.resolve();
  });

  const [first, duplicate] = await Promise.all([
    runner.handleDispatch({ id: f.dispatch.id }),
    runner.handleDispatch({ id: f.dispatch.id }),
  ]);
  assert.equal(first.accepted, true);
  assert.equal(duplicate.ignored, true);
  assert.equal(consentCalls, 1);
  assert.deepEqual(forcedRuns, ['run-1']);
  assert.equal(f.started.length, 1);
  assert.equal(f.started[0].options.maxCostUsd, 1);
  assert.deepEqual(f.accepted, [{ id: 'dispatch-1', body: { runId: 'run-1' } }]);

  f.finished.resolve();
  await eventually(() => assert.equal(f.reports.length, 1));
  assert.deepEqual(f.reports[0], {
    id: 'dispatch-1',
    report: {
      status: 'done',
      runId: 'run-1',
      summary: '整理完成',
      result: '整理完成',
      sources: [{ title: '資料來源', url: 'https://example.test/source' }],
      error: null,
      costUsd: 0.25,
    },
  });
});

test('遠端派工：auto 僅同帳號免詢問，off 一律拒絕', async (t) => {
  const sameAccount = fixture();
  let consentCalls = 0;
  const sameRunner = createRemoteRunner({
    cloud: sameAccount.cloud,
    engine: sameAccount.engine,
    store: fakeStore(),
    requestConsent: async () => {
      consentCalls += 1;
      return { accepted: true };
    },
  });
  t.after(() => {
    sameRunner.stop();
    sameAccount.finished.resolve();
  });
  const accepted = await sameRunner.handleDispatch({ id: sameAccount.dispatch.id });
  assert.equal(accepted.accepted, true);
  assert.equal(consentCalls, 0);
  assert.equal(sameAccount.started.length, 1);

  const disabled = fixture({ acceptRemote: 'off' });
  const disabledRunner = createRemoteRunner({
    cloud: disabled.cloud,
    engine: disabled.engine,
    store: fakeStore(),
    requestConsent: async () => {
      throw new Error('off 的裝置不得跳出同意視窗');
    },
  });
  t.after(() => disabledRunner.stop());
  const rejected = await disabledRunner.handleDispatch({ id: disabled.dispatch.id });
  assert.equal(rejected.accepted, false);
  assert.equal(disabled.started.length, 0);
  assert.match(disabled.rejected[0].reason, /不接受/);
});

test('遠端派工：發起方取消會傳遞為本機 run 取消', async (t) => {
  const f = fixture();
  const runner = createRemoteRunner({ cloud: f.cloud, engine: f.engine, store: fakeStore() });
  t.after(() => {
    runner.stop();
    f.finished.resolve();
  });
  await runner.handleDispatch({ id: f.dispatch.id });
  f.cloud.emit({ type: 'dispatch_update', payload: { id: f.dispatch.id, status: 'cancelled' } });
  assert.deepEqual(f.cancelled, ['run-1']);
});
