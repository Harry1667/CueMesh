import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyEvent, canRemoveMember, consentBudget, createApprovalPolicy, createConsentQueue, createRunView, deviceLabel, deviceOwner,
  dispatchBlocker, dispatchContext, dispatchStatus, dispatchTargets, isCrossAccount, isDispatchOpen, mergeDispatches, mergeProjects,
  meshOwner, mergeRun, startBlocker, targetLabel, validateCredentials, validatePassphrase, validateServerUrl,
} from '../../src/ui/logic.js';

describe('批准模式：強制逐步批准', () => {
  test('被強制的任務一律 always，其他任務照使用者設定', () => {
    const policy = createApprovalPolicy('risky');
    policy.force('r1');
    assert.equal(policy.getApprovalMode({ runId: 'r1' }), 'always');
    assert.equal(policy.getApprovalMode({ runId: 'r2' }), 'risky');
  });

  test('瀏覽器模組沒傳 runId 時，有強制中的任務就用最嚴格的模式', () => {
    const policy = createApprovalPolicy('risky');
    assert.equal(policy.getApprovalMode(), 'risky');
    policy.force('r1');
    assert.equal(policy.getApprovalMode(), 'always');
    assert.equal(policy.getApprovalMode({}), 'always');
  });

  test('任務結束後解除，設定變更立即生效，不明的值退回最嚴格', () => {
    const policy = createApprovalPolicy('risky');
    policy.force('r1');
    policy.release('r1');
    assert.equal(policy.getApprovalMode({ runId: 'r1' }), 'risky');
    policy.setMode('always');
    assert.equal(policy.getApprovalMode({ runId: 'r1' }), 'always');
    policy.setMode('???');
    assert.equal(policy.getApprovalMode(), 'always');
    assert.equal(createApprovalPolicy(undefined).getApprovalMode(), 'always');
  });
});

describe('同意佇列', () => {
  const d = (id) => ({ id, senderName: '小明', goal: '做事' });

  test('一次一個，回傳 { accepted, reason }', async () => {
    const q = createConsentQueue();
    const a = q.request(d('a'));
    const b = q.request(d('b'));
    assert.equal(q.current().id, 'a');
    assert.equal(q.waiting(), 1);
    q.respond(true);
    assert.deepEqual(await a, { accepted: true });
    assert.equal(q.current().id, 'b');
    q.respond(false, '不方便');
    assert.deepEqual(await b, { accepted: false, reason: '不方便' });
    assert.equal(q.current(), null);
  });

  test('派工被取消時視為拒絕，其他派工不受影響', async () => {
    const q = createConsentQueue();
    const a = q.request(d('a'));
    const b = q.request(d('b'));
    q.dismiss('a', '發起方取消');
    assert.deepEqual(await a, { accepted: false, reason: '發起方取消' });
    assert.equal(q.current().id, 'b');
    q.dismissAll();
    assert.equal((await b).accepted, false);
    assert.equal(q.current(), null);
  });
});

describe('同意視窗的判斷', () => {
  test('沒明確標示同帳號，一律當其他帳號', () => {
    assert.equal(isCrossAccount({ crossAccount: false }), false);
    assert.equal(isCrossAccount({ crossAccount: true }), true);
    assert.equal(isCrossAccount({}), true);
    assert.equal(isCrossAccount(null), true);
    assert.equal(isCrossAccount({ crossAccount: 'false' }), true);
  });

  test('預算取較小值，壞資料不影響', () => {
    assert.equal(consentBudget({ options: { maxCostUsd: 5 } }, 2), 2);
    assert.equal(consentBudget({ options: { maxCostUsd: 1 } }, 2), 1);
    assert.equal(consentBudget({}, 2), 2);
    assert.equal(consentBudget({ options: { maxCostUsd: '999' } }, 2), 2);
    assert.equal(consentBudget({ options: { maxCostUsd: -1 } }, null), null);
  });
});

describe('帳號表單驗證', () => {
  test('伺服器網址', () => {
    assert.deepEqual(validateServerUrl('https://a.example/'), { url: 'https://a.example' });
    assert.deepEqual(validateServerUrl('http://localhost:3000'), { url: 'http://localhost:3000' });
    assert.ok(validateServerUrl('http://10.0.0.5:3000').warning.includes('未加密'));
    for (const bad of ['', 'javascript:alert(1)', 'ftp://a', 'a.example', 'mailto:a@b.com', 'https://u:p@a.example']) {
      assert.ok(validateServerUrl(bad).error, bad);
    }
  });

  test('註冊與登入', () => {
    const ok = { email: 'a@b.co', password: '1234567890', displayName: '小明' };
    assert.equal(validateCredentials({ mode: 'register', ...ok }), null);
    assert.match(validateCredentials({ mode: 'register', ...ok, password: '123456789' }), /10/);
    assert.match(validateCredentials({ mode: 'register', ...ok, displayName: ' ' }), /顯示名稱/);
    assert.match(validateCredentials({ mode: 'login', email: 'x', password: 'y' }), /電子郵件/);
    assert.match(validateCredentials({ mode: 'login', email: 'a@b.co', password: '' }), /密碼/);
    assert.equal(validateCredentials({ mode: 'login', email: 'a@b.co', password: 'short' }), null);
  });

  test('密語：上傳要確認，下載只要輸入', () => {
    assert.match(validatePassphrase({ action: 'push', passphrase: '' }), /密語/);
    assert.match(validatePassphrase({ action: 'push', passphrase: 'short', confirm: 'short' }), /10/);
    assert.match(validatePassphrase({ action: 'push', passphrase: '1234567890', confirm: '1234567899' }), /不一樣/);
    assert.equal(validatePassphrase({ action: 'push', passphrase: '1234567890', confirm: '1234567890' }), null);
    assert.equal(validatePassphrase({ action: 'pull', passphrase: 'short' }), null);
    assert.match(validatePassphrase({ action: 'pull', passphrase: '' }), /密語/);
  });
});

describe('派工', () => {
  const devices = [
    { id: 'me', name: '這台', mine: true, online: true, acceptRemote: 'ask' },
    { id: 'friend', name: 'Mac', ownerName: '小華', mine: false, online: true, acceptRemote: 'ask' },
    { id: 'mine2', name: '筆電', mine: true, online: true, acceptRemote: 'auto' },
    { id: 'off', name: '關閉', mine: true, online: true, acceptRemote: 'off' },
    { id: 'gone', name: '離線', mine: true, online: false, acceptRemote: 'ask' },
  ];

  test('只列線上且接受派工的其他裝置，自己的排前面', () => {
    assert.deepEqual(dispatchTargets(devices, 'me').map((d) => d.id), ['mine2', 'friend']);
    assert.deepEqual(dispatchTargets(null, 'me'), []);
  });

  test('其他帳號的裝置清楚標示擁有者', () => {
    assert.match(targetLabel(devices[1]), /小華的裝置/);
    assert.match(targetLabel(devices[2]), /自動接受/);
    assert.equal(deviceOwner(devices[2]), null);
    assert.equal(deviceOwner(devices[1]), '小華');
    assert.equal(deviceLabel('字串裝置'), '字串裝置');
    assert.equal(deviceLabel(null), null);
  });

  test('裝置離線時要擋下，不可默默改在本機執行', () => {
    const base = { goal: '做', signedIn: true, online: true, target: 'friend', targets: dispatchTargets(devices, 'me'), mode: 'auto', projectId: 'p' };
    assert.equal(dispatchBlocker(base), null);
    assert.match(dispatchBlocker({ ...base, target: 'gone' }), /離線/);
    assert.match(dispatchBlocker({ ...base, signedIn: false }), /登入/);
    assert.match(dispatchBlocker({ ...base, online: false }), /連不上/);
    assert.match(dispatchBlocker({ ...base, mode: 'workflow' }), /工作流/);
    assert.match(dispatchBlocker({ ...base, goal: ' ' }), /要做什麼/);
  });

  test('派工內容不含截圖，並回報拿掉幾張', () => {
    const { items, droppedImages } = dispatchContext([
      { type: 'selection', text: '字', url: 'u', title: 't', tabId: 5 },
      { type: 'region', image: { mediaType: 'image/png', data: 'QUJD' } },
      { type: 'element', text: '按鈕', image: { mediaType: 'image/png', data: 'QUJD' } },
    ]);
    assert.equal(droppedImages, 2);
    assert.deepEqual(items.map((i) => i.type), ['selection', 'element']);
    assert.ok(!JSON.stringify(items).includes('QUJD'));
    assert.ok(!JSON.stringify(items).includes('tabId'));
  });

  test('派工清單：發出優先，新的在前', () => {
    const list = mergeDispatches([{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 3 }], [{ id: 'a', createdAt: 1 }, { id: 'c', createdAt: 2 }]);
    assert.deepEqual(list.map((d) => [d.id, d.direction]), [['b', 'incoming'], ['c', 'outgoing'], ['a', 'outgoing']]);
  });

  test('狀態與可否取消', () => {
    assert.equal(dispatchStatus('expired').label, '已逾期');
    assert.equal(dispatchStatus('沒看過').label, '沒看過');
    assert.equal(isDispatchOpen('pending'), true);
    assert.equal(isDispatchOpen('accepted'), true);
    assert.equal(isDispatchOpen('done'), false);
  });
});

describe('專案與成員', () => {
  test('合併本機與雲端專案，標示共享與只在雲端', () => {
    const list = mergeProjects(
      [{ id: 'a', name: '本機' }, { id: 'b', name: '我開的共享' }],
      [{ id: 'b', name: '我開的共享', role: 'owner', memberCount: 2 }, { id: 'c', name: '別人的', role: 'member' }],
    );
    assert.deepEqual(list.map((p) => [p.id, p.shared, p.remoteOnly]), [['a', false, false], ['b', true, false], ['c', true, true]]);
    assert.deepEqual(mergeProjects([{ id: 'a' }], null).map((p) => p.id), ['a']);
  });

  test('只在雲端的專案不能在這台開始，但不影響本機專案', () => {
    const base = { goal: '做', keyStatus: { anthropic: { set: true } }, mode: 'auto', projectId: 'c' };
    assert.match(startBlocker({ ...base, projectRemoteOnly: true }), /共享專案/);
    assert.equal(startBlocker(base), null);
  });

  test('移除權限', () => {
    const member = { userId: 'u2', role: 'member' };
    assert.equal(canRemoveMember({ member, myUserId: 'u1', myRole: 'owner' }), true);
    assert.equal(canRemoveMember({ member, myUserId: 'u2', myRole: 'member' }), true);
    assert.equal(canRemoveMember({ member, myUserId: 'u3', myRole: 'member' }), false);
    assert.equal(canRemoveMember({ member: { userId: 'u1', role: 'owner' }, myUserId: 'u1', myRole: 'owner' }), false);
  });
});

describe('跨裝置協作事件', () => {
  let seq = 0;
  const ev = (type, payload) => ({ seq: (seq += 1), runId: 'r1', type, payload, createdAt: seq });
  const view = () => createRunView({ id: 'r1' });

  test('派工、提問、回答、回報依序記錄在同一條連線', () => {
    const v = view();
    const device = { id: 'd2', name: '小華的 Mac', ownerName: '小華' };
    applyEvent(v, ev('mesh_dispatch', { taskId: 't1', device, status: 'pending', text: '查價格' }));
    applyEvent(v, ev('mesh_question', { taskId: 't1', device, status: 'accepted', text: '要含稅嗎？' }));
    applyEvent(v, ev('mesh_answer', { taskId: 't1', device, text: '要含稅' }));
    applyEvent(v, ev('mesh_report', { taskId: 't1', device, status: 'done', text: '查好了' }));
    const link = v.mesh.get('t1');
    assert.equal(link.goal, '查價格');
    assert.equal(link.status, 'done');
    assert.equal(link.device.name, '小華的 Mac');
    assert.deepEqual(link.entries.map((e) => [e.kind, e.text]), [['question', '要含稅嗎？'], ['answer', '要含稅'], ['report', '查好了']]);
  });

  test('多個子任務分開，沒有 taskId 時用裝置分組，裝置可以是字串', () => {
    const v = view();
    applyEvent(v, ev('mesh_dispatch', { taskId: 't1', device: '甲', text: 'a' }));
    applyEvent(v, ev('mesh_dispatch', { taskId: 't2', device: '乙', text: 'b' }));
    applyEvent(v, ev('mesh_report', { device: '丙', status: 'failed', text: 'c' }));
    assert.deepEqual([...v.mesh.keys()], ['t1', 't2', '丙']);
    assert.equal(v.mesh.get('丙').status, 'failed');
  });

  test('接受引擎的實際形狀：device 是字串，owner、mine 分開放', () => {
    const v = view();
    applyEvent(v, ev('mesh_dispatch', { taskId: 't1', device: '小華的 Mac', owner: '小華', mine: false, status: 'pending', text: '做' }));
    applyEvent(v, ev('mesh_dispatch', { taskId: 't1', device: '小華的 Mac', owner: '小華', mine: false, status: 'accepted', dispatchId: 'd1' }));
    applyEvent(v, ev('mesh_question', { taskId: 't1', dispatchId: 'd1', text: '問', direction: 'incoming' }));
    applyEvent(v, ev('mesh_report', { taskId: 't1', device: '小華的 Mac', owner: '小華', mine: false, status: 'done', text: '好', costUsd: 0.5 }));
    const link = v.mesh.get('t1');
    assert.equal(link.goal, '做');
    assert.equal(link.role, 'main');
    assert.equal(link.status, 'done');
    assert.equal(link.costUsd, 0.5);
    assert.equal(link.device, '小華的 Mac');
    assert.equal(meshOwner(link), '小華');
    applyEvent(v, ev('mesh_dispatch', { taskId: 't2', device: '我的筆電', owner: '我', mine: true, text: 'x' }));
    assert.equal(meshOwner(v.mesh.get('t2')), null);
  });

  test('接到派工的裝置：只有方向相反的提問與回答，角色是子 agent', () => {
    const v = view();
    applyEvent(v, ev('mesh_question', { taskId: 'local', dispatchId: 'd1', text: '要含稅嗎', direction: 'outgoing' }));
    applyEvent(v, ev('mesh_answer', { taskId: 'local', dispatchId: 'd1', text: '要', direction: 'incoming' }));
    assert.equal(v.mesh.get('local').role, 'sub');
    assert.equal(v.mesh.get('local').entries.length, 2);
  });

  test('重複事件不重複，壞資料不丟錯，getRun 重播可還原', () => {
    const v = view();
    const e = ev('mesh_question', { taskId: 't1', device: '甲', text: '問' });
    applyEvent(v, e);
    assert.equal(applyEvent(v, e), false);
    assert.equal(v.mesh.get('t1').entries.length, 1);
    assert.equal(applyEvent(v, { type: 'mesh_report', payload: null, runId: 'r1' }), true);
    const h = view();
    mergeRun(h, { id: 'r1', events: [e] });
    assert.equal(h.mesh.get('t1').entries[0].text, '問');
  });
});
