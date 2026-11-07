import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserController, cropRectForDevicePixels } from '../../src/browser/index.js';

function fakeChrome({ tabs: initialTabs = [{ id: 1, windowId: 10, url: 'https://safe.example/start', title: '安全頁面' }], responses = {} } = {}) {
  const tabsById = new Map(initialTabs.map((tab) => [tab.id, { ...tab }]));
  const calls = { injected: [], messages: [], approvals: [], updates: [], created: [], captures: [] };
  let nextTabId = Math.max(0, ...tabsById.keys()) + 1;

  const chromeApi = {
    scripting: {
      async executeScript(params) {
        calls.injected.push(params);
      },
    },
    tabs: {
      async query() {
        return [[...tabsById.values()][0]];
      },
      async get(id) {
        const tab = tabsById.get(id);
        if (!tab) throw new Error('找不到分頁');
        return { ...tab };
      },
      async sendMessage(id, message) {
        calls.messages.push({ id, message });
        const answer = responses[message.command];
        if (typeof answer === 'function') return answer({ id, message });
        if (answer !== undefined) return answer;
        if (message.command === 'snapshot') return { ok: true, snapshot: { url: 'https://safe.example/start', title: '安全頁面', text: '內容', elements: [] } };
        if (message.command === 'inspect_ref') return {
          ok: true,
          element: { ref: message.args.ref, tag: 'button', role: 'button', name: '儲存', text: '儲存', type: 'button' },
          fingerprint: 'fingerprint-1',
        };
        if (message.command === 'inspect_focused') return { ok: true, element: null };
        return { ok: true, text: '完成' };
      },
      async captureVisibleTab(windowId, options) {
        calls.captures.push({ windowId, options });
        return 'data:image/png;base64,QUJD';
      },
      async update(id, patch) {
        calls.updates.push({ id, patch });
        const tab = tabsById.get(id);
        Object.assign(tab, patch);
        return { ...tab };
      },
      async create(options) {
        calls.created.push(options);
        const tab = { id: nextTabId++, windowId: options.windowId ?? 10, url: options.url, title: '' };
        tabsById.set(tab.id, tab);
        return { ...tab };
      },
    },
  };
  return { chromeApi, calls, tabsById };
}

test('唯讀快照會注入隔離 content script，且不要求批准', async () => {
  const fake = fakeChrome();
  const controller = createBrowserController({
    chromeApi: fake.chromeApi,
    requestApproval: async (payload) => { fake.calls.approvals.push(payload); return { approved: true }; },
  });
  const result = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_snapshot', args: {} });
  assert.equal(result.ok, true);
  assert.match(result.text, /安全頁面/);
  assert.equal(fake.calls.injected.length, 1);
  assert.equal(fake.calls.messages[0].message.channel, 'cuemesh-content-v1');
  assert.equal(fake.calls.approvals.length, 0);
});

test('一個任務只能操作起始分頁與自己建立的分頁', async () => {
  const fake = fakeChrome({ tabs: [
    { id: 1, windowId: 10, url: 'https://safe.example/a', title: 'A' },
    { id: 2, windowId: 10, url: 'https://safe.example/b', title: 'B' },
  ] });
  const controller = createBrowserController({ chromeApi: fake.chromeApi });
  assert.equal((await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_snapshot', args: {} })).ok, true);
  const denied = await controller.execute({ runId: 'run-a', tabId: 2, tool: 'browser_snapshot', args: {} });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /其他分頁/);
});

test('危險按鈕即使顯示安全文案，仍會把所有語意交給批准介面', async () => {
  const fake = fakeChrome({
    responses: {
      inspect_ref: { ok: true, fingerprint: 'fingerprint-1', element: {
        tag: 'button', type: 'button', name: '取消', text: '取消', ariaLabel: 'Confirm purchase',
      } },
    },
  });
  const controller = createBrowserController({
    chromeApi: fake.chromeApi,
    getApprovalMode: () => 'risky',
    requestApproval: async (payload) => { fake.calls.approvals.push(payload); return { approved: false, note: '不購買' }; },
  });
  const result = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_click', args: { ref: 'e1' } });
  assert.deepEqual(result, { ok: false, denied: true, error: '不購買' });
  assert.equal(fake.calls.approvals.length, 1);
  assert.equal(fake.calls.approvals[0].risk, 'high');
  assert.equal(fake.calls.messages.some(({ message }) => message.command === 'click'), false);
});

test('密碼與隱藏信用卡欄位會直接拒絕，絕不送出 type 指令', async () => {
  const fake = fakeChrome({
    responses: {
      inspect_ref: { ok: true, fingerprint: 'fingerprint-1', element: {
        tag: 'input', type: 'text', hidden: true, fieldName: 'card_number', ariaLabel: '一般備註', editable: true,
      } },
    },
  });
  const controller = createBrowserController({
    chromeApi: fake.chromeApi,
    requestApproval: async (payload) => { fake.calls.approvals.push(payload); return { approved: true }; },
  });
  const result = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_type', args: { ref: 'e1', text: '4111111111111111' } });
  assert.equal(result.ok, false);
  assert.match(result.error, /親自輸入/);
  assert.equal(fake.calls.approvals.length, 0);
  assert.equal(fake.calls.messages.some(({ message }) => message.command === 'type'), false);
});

test('risky 模式允許低風險點擊，但動作前會帶入批准後不可變的指紋', async () => {
  const fake = fakeChrome();
  const controller = createBrowserController({ chromeApi: fake.chromeApi, getApprovalMode: () => 'risky' });
  const result = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_click', args: { ref: 'e1' } });
  assert.equal(result.ok, true);
  const click = fake.calls.messages.find(({ message }) => message.command === 'click');
  assert.equal(click.message.args.expectedFingerprint, 'fingerprint-1');
});

test('導覽只接受安全協定，且新分頁會綁定到同一個任務', async () => {
  const fake = fakeChrome();
  const controller = createBrowserController({ chromeApi: fake.chromeApi, getApprovalMode: () => 'risky' });
  const invalid = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_navigate', args: { url: 'javascript:alert(1)' } });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /http 或 https/);

  const opened = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_new_tab', args: { url: 'https://safe.example/new' } });
  assert.equal(opened.ok, true);
  // engine 會繼續傳入起始 tabId；controller 仍必須留在剛建立的新分頁。
  const snapshot = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_snapshot', args: {} });
  assert.equal(snapshot.ok, true);
  assert.equal(fake.calls.messages.at(-1).id, 2);

  controller.releaseRun('run-a');
  const afterRelease = await controller.execute({ runId: 'run-a', tabId: 1, tool: 'browser_snapshot', args: {} });
  assert.equal(afterRelease.ok, true);
});

test('情境擷取回傳選取內容，取消則回傳 null', async () => {
  const selected = fakeChrome({ responses: { capture_context: { ok: true, text: '選取內容', url: 'https://safe.example/a', title: 'A' } } });
  const controller = createBrowserController({ chromeApi: selected.chromeApi });
  assert.deepEqual(await controller.captureContext('selection', { tabId: 1 }), {
    type: 'selection', tabId: 1, url: 'https://safe.example/a', title: 'A', text: '選取內容',
  });

  const cancelled = fakeChrome({ responses: { capture_context: { ok: true, cancelled: true } } });
  const cancelController = createBrowserController({ chromeApi: cancelled.chromeApi });
  assert.equal(await cancelController.captureContext('element', { tabId: 1 }), null);
});

test('區域截圖座標依 devicePixelRatio 換算並限制於圖像範圍', () => {
  assert.deepEqual(cropRectForDevicePixels({ x: 10, y: 5, width: 20, height: 10 }, 2, 100, 100), {
    x: 20, y: 10, width: 40, height: 20,
  });
  assert.deepEqual(cropRectForDevicePixels({ x: -5, y: 45, width: 20, height: 20 }, 2, 100, 100), {
    x: 0, y: 90, width: 30, height: 10,
  });
  assert.equal(cropRectForDevicePixels({ x: 10, y: 10, width: 0, height: 1 }, 2, 100, 100), null);
});

test('captureContext 失敗時丟錯，不回傳會被當成情境的物件', async () => {
  const controller = createBrowserController({ chromeApi: { tabs: { query: async () => [{ id: 1, url: 'chrome://settings' }] } } });
  await assert.rejects(controller.captureContext('page', {}), /受保護/);
});

test('任務結束後才按批准，動作不會執行', async () => {
  let release;
  const sent = [];
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 1, url: 'https://a.test/', windowId: 1 }],
      get: async () => ({ id: 1, url: 'https://a.test/', windowId: 1 }),
      sendMessage: async (_id, msg) => {
        sent.push(msg.command);
        return msg.command === 'inspect_ref'
          ? { ok: true, element: { tag: 'button', name: 'OK' }, fingerprint: 'f' }
          : { ok: true };
      },
    },
    scripting: { executeScript: async () => {} },
  };
  const controller = createBrowserController({
    chromeApi,
    getApprovalMode: () => 'always',
    requestApproval: () => new Promise((resolve) => { release = resolve; }),
  });
  const pending = controller.execute({ runId: 'r1', tool: 'browser_click', args: { ref: 'e1' } });
  while (!release) await new Promise((r) => setTimeout(r, 1));
  controller.releaseRun('r1');
  release({ approved: true });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.denied, true);
  assert.ok(!sent.includes('click'));
});
