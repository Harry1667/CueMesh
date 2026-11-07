import assert from 'node:assert/strict';
import test from 'node:test';
import { createMesh } from '../../src/cloud/mesh.js';
import { eventually } from './helpers.js';

test('Mesh：signal 取消會傳遞到雲端派工', async () => {
  const cancelled = [];
  const cloud = {
    subscribe() { return () => {}; },
    getDevice: () => ({ id: 'mine' }),
    async listDevices() { return []; },
    async dispatch() { return { id: 'dispatch-1', status: 'pending' }; },
    async getDispatch() { return { dispatch: { id: 'dispatch-1', status: 'pending' }, messages: [] }; },
    async cancelDispatch(id) { cancelled.push(id); },
  };
  const mesh = createMesh({ cloud, pollMs: 5 });
  const controller = new AbortController();
  const waiting = mesh.dispatch({ targetDeviceId: 'other', projectId: 'p1', goal: '工作', signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (error) => error.name === 'AbortError');
  await eventually(() => assert.deepEqual(cancelled, ['dispatch-1']));
  mesh.stop();
});

test('Mesh：輪詢補到遺失的完成事件，並由 SSE 收到提問回答', async () => {
  const listeners = new Set();
  let dispatchStatus = 'pending';
  const cloud = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    getDevice: () => ({ id: 'mine' }),
    async listDevices() {
      return [
        { id: 'mine', name: '本機', ownerName: '我', online: true, acceptRemote: 'ask' },
        { id: 'other', name: '另一台', ownerName: '測試者', online: true, acceptRemote: 'ask' },
      ];
    },
    async dispatch() { return { id: 'dispatch-2', status: 'pending' }; },
    async getDispatch(id) {
      return {
        dispatch: {
          id,
          status: dispatchStatus,
          summary: '完成摘要',
          result: '完成內容',
          sources: [],
          costUsd: 0.1,
        },
        messages: [],
      };
    },
    async sendDispatchMessage(id, message) {
      if (message.kind === 'question') {
        setTimeout(() => cloud.emit({
          type: 'dispatch_message',
          payload: {
            message: { id: 'answer-1', dispatchId: id, kind: 'answer', replyTo: message.id, text: '確認回答' },
          },
        }), 5);
      }
      return { id: message.id, dispatchId: id, ...message };
    },
    async cancelDispatch() {},
  };
  const mesh = createMesh({ cloud, pollMs: 5 });
  try {
    assert.deepEqual(await mesh.listDevices(), [
      { id: 'other', name: '另一台', ownerName: '測試者', mine: false, online: true, acceptRemote: 'ask' },
    ]);
    const waiting = mesh.dispatch({ targetDeviceId: 'other', projectId: 'p1', goal: '工作' });
    dispatchStatus = 'done'; // 不送 SSE，下一次 GET 輪詢必須補到。
    assert.deepEqual(await waiting, {
      status: 'done', summary: '完成摘要', result: '完成內容', sources: [], error: null, costUsd: 0.1,
    });
    assert.equal(await mesh.ask({ dispatchId: 'dispatch-2', text: '要確認什麼？' }), '確認回答');
  } finally {
    mesh.stop();
  }
});
