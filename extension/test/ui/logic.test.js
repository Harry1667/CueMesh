import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  applyEvent, applyMention, buildStartOptions, collectSources, createApprovalQueue, createRunView, currentStep, describeArgs,
  describeElement, describeUrl, filterMentions, findMentionQuery, formatDuration, formatUsd, imageDataUrl, mergeRun,
  mentionedProviders, moveItem, normalizeRunRow, normalizeStats, parseMaxCost, PROVIDERS, retryContext, safeFilename, startBlocker,
  stripControls, taskProgress, taskTree, validateWorkflow, workflowPayload,
} from '../../src/ui/logic.js';

let seq = 0;
const ev = (type, payload = {}, extra = {}) => ({ seq: (seq += 1), runId: 'r1', type, payload, createdAt: 1000 + seq, ...extra });
const view = () => createRunView({ id: 'r1', goal: '比較價格' });

describe('applyEvent：事件處理', () => {
  test('用 seq 去重，重複事件不重複累加', () => {
    const v = view();
    const usage = ev('usage', { input: 100, output: 50, costUsd: 0.01, totalCostUsd: 0.01 });
    assert.equal(applyEvent(v, usage), true);
    assert.equal(applyEvent(v, usage), false);
    assert.equal(v.run.inputTokens, 100);
    assert.equal(v.run.outputTokens, 50);
  });

  test('其他 Run 的事件不影響這個檢視', () => {
    const v = view();
    assert.equal(applyEvent(v, ev('notice', { text: '別人的' }, { runId: 'r2' })), false);
    assert.equal(v.feed.length, 0);
  });

  test('未知事件與壞資料不丟錯', () => {
    const v = view();
    assert.equal(applyEvent(v, ev('never_seen', {})), false);
    assert.equal(applyEvent(v, null), false);
    assert.equal(applyEvent(v, ev('task_created', { title: '沒有 id' })), false);
    assert.equal(applyEvent(v, { type: 'notice', payload: 'not-an-object', runId: 'r1' }), true);
  });

  test('run_update 同時接受規格欄位與資料庫欄位', () => {
    const v = view();
    applyEvent(v, ev('run_update', { fields: { plan_summary: '先查資料', status: 'running' } }));
    applyEvent(v, ev('run_update', { fields: { finalResult: '# 結果', costUsd: 0.5 } }));
    assert.equal(v.run.planSummary, '先查資料');
    assert.equal(v.run.status, 'running');
    assert.equal(v.run.finalResult, '# 結果');
    assert.equal(v.run.costUsd, 0.5);
  });

  test('plan 記錄計畫與預估費用', () => {
    const v = view();
    applyEvent(v, ev('plan', { summary: '分兩步', tasks: [{ key: 't1', title: '查', agent: 'research' }], estimatedCostUsd: 0.08 }));
    assert.equal(v.plan.estimatedCostUsd, 0.08);
    assert.equal(v.plan.tasks.length, 1);
    assert.equal(v.run.planSummary, '分兩步');
  });

  test('task_created 與 task_update 更新子任務，含來源 JSON 與資料庫欄位', () => {
    const v = view();
    applyEvent(v, ev('task_created', { taskId: 't1', parentTaskId: null, title: '查價格', agent: 'research', position: 0 }));
    applyEvent(v, ev('task_update', { taskId: 't1', fields: { status: 'running', provider: 'openai', model: 'gpt-6.1-sol', started_at: 5 } }));
    applyEvent(v, ev('task_update', {
      taskId: 't1',
      fields: {
        status: 'done',
        result: '好了',
        finished_at: 9,
        sources_json: JSON.stringify([{ title: '官網', url: 'https://example.com' }, { title: '惡意', url: 'javascript:alert(1)' }]),
      },
    }));
    const task = v.tasks.get('t1');
    assert.equal(task.status, 'done');
    assert.equal(task.model, 'gpt-6.1-sol');
    assert.equal(task.startedAt, 5);
    assert.equal(task.finishedAt, 9);
    assert.deepEqual(task.sources, [{ title: '官網', url: 'https://example.com/' }]);
  });

  test('task_update 先於 task_created 也不會遺失', () => {
    const v = view();
    applyEvent(v, ev('task_update', { taskId: 't9', fields: { status: 'running' } }));
    applyEvent(v, ev('task_created', { taskId: 't9', title: '後到', agent: 'coding' }));
    assert.equal(v.tasks.get('t9').status, 'running');
    assert.equal(v.tasks.get('t9').title, '後到');
  });

  test('壞掉的來源 JSON 不丟錯', () => {
    const v = view();
    applyEvent(v, ev('task_update', { taskId: 't1', fields: { sources_json: '{壞掉' } }));
    assert.deepEqual(v.tasks.get('t1').sources, []);
  });

  test('tool_call 與 browser_result 配對到最早未完成的同工具紀錄', () => {
    const v = view();
    applyEvent(v, ev('tool_call', { taskId: 't1', tool: 'browser_click', args: { ref: 'e1' } }));
    applyEvent(v, ev('tool_call', { taskId: 't1', tool: 'browser_click', args: { ref: 'e2' } }));
    applyEvent(v, ev('browser_result', { taskId: 't1', tool: 'browser_click', ok: true, denied: false, error: null }));
    applyEvent(v, ev('browser_result', { taskId: 't1', tool: 'browser_click', ok: false, denied: true, error: '使用者拒絕' }));
    assert.equal(v.browserLog[0].state, 'ok');
    assert.equal(v.browserLog[1].state, 'denied');
    assert.equal(v.browserLog[1].error, '使用者拒絕');
  });

  test('沒有對應 tool_call 的 browser_result 也要留紀錄', () => {
    const v = view();
    applyEvent(v, ev('browser_result', { taskId: 't1', tool: 'browser_type', ok: false, denied: false, error: '不可輸入密碼' }));
    assert.equal(v.browserLog[0].state, 'error');
    assert.equal(v.browserLog[0].error, '不可輸入密碼');
  });

  test('非瀏覽器工具進協作動態，不進瀏覽器紀錄', () => {
    const v = view();
    applyEvent(v, ev('tool_call', { taskId: 't1', tool: 'workspace_write', args: { name: 'a.md' } }));
    assert.equal(v.browserLog.length, 0);
    assert.equal(v.feed[0].kind, 'tool');
  });

  test('mention 標記被委派的任務', () => {
    const v = view();
    applyEvent(v, ev('task_created', { taskId: 'c1', parentTaskId: 't1', title: '@research：查', agent: 'research' }));
    applyEvent(v, ev('mention', { fromTaskId: 't1', fromAgent: 'coding', toTaskId: 'c1', agent: 'research', request: '請查牌價' }));
    assert.deepEqual(v.tasks.get('c1').mention, { fromAgent: 'coding', request: '請查牌價' });
    assert.equal(v.feed[0].kind, 'mention');
  });

  test('fallback 記到任務與動態；規劃階段沒有 taskId 也可以', () => {
    const v = view();
    applyEvent(v, ev('fallback', { taskId: 't1', provider: 'anthropic', model: 'claude-opus-5-5', reason: '逾時' }));
    applyEvent(v, ev('fallback', { stage: 'planning', provider: 'openai', model: 'gpt-6.1-sol', reason: '限流' }));
    assert.equal(v.tasks.get('t1').fallbacks[0].model, 'claude-opus-5-5');
    assert.equal(v.feed.length, 2);
    assert.equal(v.feed[1].stage, 'planning');
  });

  test('usage 以 totalCostUsd 為準，累加 token', () => {
    const v = view();
    applyEvent(v, ev('usage', { input: 10, output: 5, costUsd: 0.1, totalCostUsd: 0.1 }));
    applyEvent(v, ev('usage', { input: 20, output: 5, costUsd: 0.2, totalCostUsd: 0.3 }));
    assert.equal(v.run.costUsd, 0.3);
    assert.equal(v.run.inputTokens, 30);
  });

  test('artifact 同名覆寫，不重複列出', () => {
    const v = view();
    applyEvent(v, ev('artifact', { artifactId: 'a1', name: 'index.html', kind: 'html', createdBy: '3d' }));
    applyEvent(v, ev('artifact', { artifactId: 'a1', name: 'index.html', kind: 'html', createdBy: 'coding' }));
    assert.equal(v.artifacts.length, 1);
    assert.equal(v.artifacts[0].createdBy, 'coding');
  });

  test('run_finished 帶錯誤，等待中的瀏覽器動作不會永遠卡住', () => {
    const v = view();
    v.cancelling = true;
    applyEvent(v, ev('tool_call', { taskId: 't1', tool: 'browser_click', args: {} }));
    applyEvent(v, ev('run_finished', { status: 'failed', error: '所有模型都失敗' }));
    assert.equal(v.run.status, 'failed');
    assert.equal(v.run.error, '所有模型都失敗');
    assert.equal(v.cancelling, false);
    assert.equal(v.browserLog[0].state, 'abandoned');
  });

  test('動態紀錄有上限，長任務不會把記憶體吃光', () => {
    const v = view();
    for (let i = 0; i < 500; i += 1) applyEvent(v, ev('notice', { text: `第 ${i} 則` }));
    assert.equal(v.feed.length, 300);
    assert.equal(v.feed.at(-1).text, '第 499 則');
  });
});

describe('mergeRun 與 taskTree', () => {
  test('getRun 補上成果內容、最終結果與資料庫欄位', () => {
    const v = view();
    applyEvent(v, ev('artifact', { artifactId: 'a1', name: 'a.html', kind: 'html' }));
    mergeRun(v, {
      id: 'r1',
      status: 'done',
      final_result: '完成',
      tasks: [{ id: 't1', title: '查', agent_type: 'research', status: 'done', sources_json: '[{"title":"甲","url":"https://a.com"}]' }],
      artifacts: [{ id: 'a1', name: 'a.html', kind: 'html', content: '<h1>x</h1>', created_by: '3d' }],
    });
    assert.equal(v.run.finalResult, '完成');
    assert.equal(v.tasks.get('t1').agent, 'research');
    assert.equal(v.artifacts[0].content, '<h1>x</h1>');
    assert.equal(v.artifacts[0].createdBy, '3d');
    assert.equal(collectSources(v)[0].url, 'https://a.com/');
  });

  test('getRun 帶 events 時可以重播，供歷史任務使用，重複事件會去重', () => {
    const v = view();
    const events = [ev('notice', { text: '一' }), ev('notice', { text: '二' })];
    mergeRun(v, { id: 'r1', events });
    mergeRun(v, { id: 'r1', events });
    assert.equal(v.feed.length, 2);
  });

  test('較舊的快照晚到時，已結束的任務不會變回執行中', () => {
    const v = view();
    applyEvent(v, ev('run_finished', { status: 'done' }));
    mergeRun(v, { id: 'r1', status: 'running', finalResult: '結果' });
    assert.equal(v.run.status, 'done');
    assert.equal(v.run.finalResult, '結果');
    // 反過來，已結束的快照可以更新執行中的檢視
    const w = view();
    w.run.status = 'running';
    mergeRun(w, { id: 'r1', status: 'failed' });
    assert.equal(w.run.status, 'failed');
  });

  test('getRun 的情境沒有截圖，不可蓋掉記憶體裡的完整情境', () => {
    const v = view();
    v.context = [{ type: 'region', image: { mediaType: 'image/png', data: 'QUJD' } }];
    mergeRun(v, { id: 'r1', context: [{ type: 'region', hasImage: true }] });
    assert.ok(v.context[0].image);
    // 歷史任務沒有記憶體版本，才用儲存的情境
    const h = view();
    mergeRun(h, { id: 'r1', context: [{ type: 'region', hasImage: true }] });
    assert.equal(h.context[0].hasImage, true);
  });

  test('重試時截圖遺失要回報，文字情境保留', () => {
    const { items, droppedImages } = retryContext([
      { type: 'selection', text: '文字' },
      { type: 'region', hasImage: true },
      { type: 'element', hasImage: true, text: '按鈕' },
      { type: 'region', image: { mediaType: 'image/png', data: 'QUJD' } },
    ]);
    assert.deepEqual(items.map((i) => i.type), ['selection', 'element', 'region']);
    assert.equal(droppedImages, 2);
    assert.deepEqual(retryContext(undefined), { items: [], droppedImages: 0 });
  });

  test('委派任務排在母任務底下', () => {
    const v = view();
    applyEvent(v, ev('task_created', { taskId: 'b', title: '乙', agent: 'coding', position: 1 }));
    applyEvent(v, ev('task_created', { taskId: 'a', title: '甲', agent: 'research', position: 0 }));
    applyEvent(v, ev('task_created', { taskId: 'c', parentTaskId: 'b', title: '丙', agent: 'review', position: 1001 }));
    const tree = taskTree(v);
    assert.deepEqual(tree.map((n) => n.task.id), ['a', 'b']);
    assert.deepEqual(tree[1].children.map((n) => n.task.id), ['c']);
  });

  test('母任務不存在或循環引用時退回最上層，不會無窮遞迴也不會遺失', () => {
    const v = view();
    applyEvent(v, ev('task_created', { taskId: 'orphan', parentTaskId: 'nope', title: '孤兒' }));
    applyEvent(v, ev('task_created', { taskId: 'x', parentTaskId: 'y', title: 'x' }));
    applyEvent(v, ev('task_created', { taskId: 'y', parentTaskId: 'x', title: 'y' }));
    applyEvent(v, ev('task_created', { taskId: 'self', parentTaskId: 'self', title: '自己' }));
    const ids = taskTree(v).map((n) => n.task.id).sort();
    assert.deepEqual(ids, ['orphan', 'self', 'x', 'y']);
  });

  test('進度統計', () => {
    const v = view();
    applyEvent(v, ev('task_update', { taskId: 'a', fields: { status: 'done' } }));
    applyEvent(v, ev('task_update', { taskId: 'b', fields: { status: 'failed' } }));
    applyEvent(v, ev('task_update', { taskId: 'c', fields: { status: 'running' } }));
    assert.deepEqual(taskProgress(v), { total: 3, done: 1, failed: 1, running: 1 });
  });

  test('歷史列表欄位正規化', () => {
    const row = normalizeRunRow({ id: 'r', goal: '目標', status: 'done', cost_usd: 0.1, created_at: 5, finished_at: 9 });
    assert.equal(row.costUsd, 0.1);
    assert.equal(row.createdAt, 5);
    assert.equal(row.finishedAt, 9);
  });
});

describe('批准佇列', () => {
  const req = (runId, tool = 'browser_click') => ({ runId, tool, args: {}, risk: 'act', reason: '點擊' });

  test('一次一個，依序處理', async () => {
    const q = createApprovalQueue();
    const first = q.request(req('r1', 'browser_click'));
    const second = q.request(req('r1', 'browser_type'));
    assert.equal(q.current().tool, 'browser_click');
    assert.equal(q.waiting(), 1);
    q.respond(true);
    assert.deepEqual(await first, { approved: true });
    assert.equal(q.current().tool, 'browser_type');
    assert.equal(q.waiting(), 0);
    q.respond(false, '不要按');
    assert.deepEqual(await second, { approved: false, note: '不要按' });
    assert.equal(q.current(), null);
  });

  test('沒有請求時 respond 不丟錯', () => {
    assert.equal(createApprovalQueue().respond(true), false);
  });

  test('連按兩次不會誤批下一個請求以外的東西：每次只處理佇列頭', async () => {
    const q = createApprovalQueue();
    const a = q.request(req('r1'));
    q.respond(true);
    assert.equal(q.respond(true), false);
    assert.deepEqual(await a, { approved: true });
  });

  test('任務結束時，它的請求全部視為拒絕，其他任務不受影響', async () => {
    const q = createApprovalQueue();
    const a = q.request(req('r1'));
    const b = q.request(req('r2'));
    const c = q.request(req('r1'));
    assert.equal(q.dismissRun('r1', '任務已取消'), 2);
    assert.deepEqual(await a, { approved: false, note: '任務已取消' });
    assert.deepEqual(await c, { approved: false, note: '任務已取消' });
    assert.equal(q.current().runId, 'r2');
    q.respond(true);
    assert.deepEqual(await b, { approved: true });
  });

  test('訂閱者會收到目前請求與排隊數', () => {
    const q = createApprovalQueue();
    const seen = [];
    const off = q.subscribe((current, waiting) => seen.push([current?.tool ?? null, waiting]));
    q.request(req('r1', 'a'));
    q.request(req('r1', 'b'));
    q.respond(true);
    q.respond(false);
    off();
    q.request(req('r1', 'c'));
    assert.deepEqual(seen, [['a', 0], ['a', 1], ['b', 0], [null, 0]]);
  });
});

describe('@ 自動完成', () => {
  test('開頭與空白後才觸發，和 router 規則一致', () => {
    assert.deepEqual(findMentionQuery('@re', 3), { query: 're', start: 0, end: 3 });
    assert.deepEqual(findMentionQuery('幫我 @co', 6), { query: 'co', start: 3, end: 6 });
    assert.equal(findMentionQuery('幫我@co', 5), null);
    assert.equal(findMentionQuery('mail a@b', 8), null);
    assert.equal(findMentionQuery('@research 後面', 12), null);
  });

  test('只看游標之前的文字', () => {
    assert.deepEqual(findMentionQuery('@re 後面', 3), { query: 're', start: 0, end: 3 });
  });

  test('八個提及都有，能依前綴篩選', () => {
    assert.deepEqual(
      filterMentions('').map((m) => m.word),
      ['research', 'coding', '3d', 'vision', 'review', 'browser', 'claude', 'openai'],
    );
    assert.deepEqual(filterMentions('RE').map((m) => m.word), ['research', 'review']);
    assert.deepEqual(filterMentions('zzz'), []);
  });

  test('套用時補空白並回傳游標位置', () => {
    const text = '幫我 @co 看看';
    const match = findMentionQuery(text, 6);
    assert.deepEqual(applyMention(text, match, 'coding'), { text: '幫我 @coding 看看', caret: 10 });
    assert.deepEqual(applyMention('@re', findMentionQuery('@re', 3), 'research'), { text: '@research ', caret: 10 });
  });

  test('已移除的 Gemini 不再是選項', () => {
    assert.deepEqual(filterMentions('ge'), []);
    assert.deepEqual(filterMentions('goo'), []);
    assert.deepEqual(mentionedProviders('@gemini @google 幫我'), []);
    assert.deepEqual(PROVIDERS.map((p) => p.id), ['anthropic', 'openai']);
  });

  test('解析指定的供應商，含 @claude 別名', () => {
    assert.deepEqual(mentionedProviders('@claude 和 @openai 比較 @research'), ['anthropic', 'openai']);
    assert.deepEqual(mentionedProviders('沒有提及'), []);
  });
});

describe('開始任務的條件', () => {
  const ok = { goal: '做事', keyStatus: { anthropic: { set: true, last4: 'abcd' } }, mode: 'auto', workflows: [], projectId: 'p1' };

  test('條件齊全可以開始', () => assert.equal(startBlocker(ok), null));
  test('沒有 key', () => assert.match(startBlocker({ ...ok, keyStatus: {} }), /API key/));
  test('空白目標', () => assert.match(startBlocker({ ...ok, goal: '   ' }), /要做什麼/));
  test('已有任務在跑', () => assert.match(startBlocker({ ...ok, activeRunId: 'r' }), /正在執行/));
  test('沒有專案', () => assert.match(startBlocker({ ...ok, projectId: null }), /專案/));
  test('AI 議會需要兩家', () => {
    assert.match(startBlocker({ ...ok, mode: 'council' }), /兩家/);
    const two = { anthropic: { set: true }, openai: { set: true } };
    assert.equal(startBlocker({ ...ok, mode: 'council', keyStatus: two }), null);
  });
  test('工作流模式要選工作流', () => {
    assert.match(startBlocker({ ...ok, mode: 'workflow' }), /還沒有工作流/);
    const workflows = [{ id: 'w1', name: '流程' }];
    assert.match(startBlocker({ ...ok, mode: 'workflow', workflows }), /選擇/);
    assert.equal(startBlocker({ ...ok, mode: 'workflow', workflows, workflowId: 'w1' }), null);
  });
  test('@ 指定了沒有 key 的 AI', () => {
    assert.match(startBlocker({ ...ok, goal: '@openai 幫我' }), /OpenAI/);
    assert.equal(startBlocker({ ...ok, goal: '@claude 幫我' }), null);
  });

  test('組出引擎需要的 options', () => {
    assert.deepEqual(buildStartOptions({ mode: 'auto', maxCostUsd: 2 }), { mode: 'auto', maxCostUsd: 2 });
    assert.deepEqual(buildStartOptions({ mode: 'council' }), { mode: 'council' });
    assert.deepEqual(buildStartOptions({ mode: 'workflow', workflowId: 'w1', maxCostUsd: 1 }), { workflowId: 'w1', maxCostUsd: 1 });
  });
});

describe('目前步驟摘要', () => {
  test('依序：規劃、單一任務、多個任務、瀏覽器動作、結束', () => {
    const v = view();
    assert.match(currentStep(v), /拆成子任務/);
    applyEvent(v, ev('task_created', { taskId: 'a', title: '查價格', agent: 'research' }));
    assert.match(currentStep(v), /準備/);
    applyEvent(v, ev('task_update', { taskId: 'a', fields: { status: 'running' } }));
    assert.equal(currentStep(v), '查價格（@research）');
    applyEvent(v, ev('task_update', { taskId: 'b', fields: { status: 'running', title: '寫程式' } }));
    assert.match(currentStep(v), /2 個子任務/);
    applyEvent(v, ev('tool_call', { taskId: 'a', tool: 'browser_navigate', args: { url: 'https://a.com' } }));
    assert.equal(currentStep(v), '前往網址：https://a.com');
    v.cancelling = true;
    assert.match(currentStep(v), /取消/);
    applyEvent(v, ev('run_finished', { status: 'done' }));
    assert.equal(currentStep(v), null);
  });
});

describe('顯示與安全小工具', () => {
  test('費用與時間格式', () => {
    assert.equal(formatUsd(0.0123), 'US$0.0123');
    assert.equal(formatUsd(2), 'US$2.00');
    assert.equal(formatUsd(undefined), '—');
    assert.equal(formatDuration(65_000), '01:05');
    assert.equal(formatDuration(-1), '—');
  });

  test('拿掉雙向覆寫與控制字元，避免批准對話框被視覺欺騙', () => {
    assert.equal(stripControls('safe‮txt.exe\u0000'), 'safetxt.exe');
    assert.equal(describeUrl('https://exam‮ple.com/a').full, 'https://example.com/a');
  });

  test('網址顯示主機，壞網址也不丟錯', () => {
    assert.equal(describeUrl('https://shop.example.com/pay?a=1').host, 'shop.example.com');
    assert.deepEqual(describeUrl('不是網址'), { host: null, full: '不是網址' });
    assert.equal(describeUrl(null), null);
  });

  test('目標元素接受字串或物件', () => {
    assert.equal(describeElement('送出按鈕'), '送出按鈕');
    assert.equal(describeElement({ role: 'button', name: '刪除帳號' }), 'button 「刪除帳號」');
    assert.equal(describeElement({ ref: 'e12' }), '元素 e12');
    assert.equal(describeElement(null), null);
  });

  test('工具參數摘要', () => {
    assert.equal(describeArgs('browser_scroll', { pixels: -200 }), '往上 200 像素');
    assert.equal(describeArgs('browser_navigate', { url: 'https://a.com' }), 'https://a.com');
    assert.equal(describeArgs('browser_type', { ref: 'e1', text: 'hi' }), '「hi」到元素 e1');
    assert.equal(describeArgs('browser_snapshot', null), '');
  });

  test('縮圖只接受點陣圖與合法 base64，拒絕 SVG 與注入', () => {
    assert.equal(imageDataUrl({ mediaType: 'image/png', data: 'QUJD' }), 'data:image/png;base64,QUJD');
    assert.equal(imageDataUrl({ mediaType: 'image/svg+xml', data: 'QUJD' }), null);
    assert.equal(imageDataUrl({ mediaType: 'image/png', data: 'x"><script>' }), null);
    assert.equal(imageDataUrl(null), null);
  });

  test('下載檔名移除路徑與特殊字元', () => {
    assert.equal(safeFilename('../../etc/passwd'), 'etc-passwd');
    assert.equal(safeFilename('a/b\\c.html'), 'a-b-c.html');
    assert.equal(safeFilename('...'), 'cuemesh-成果.txt');
    assert.equal(safeFilename(''), 'cuemesh-成果.txt');
  });
});

describe('設定頁邏輯', () => {
  test('預算上限驗證', () => {
    assert.deepEqual(parseMaxCost('2.5'), { value: 2.5 });
    assert.ok(parseMaxCost('').error);
    assert.ok(parseMaxCost('abc').error);
    assert.ok(parseMaxCost('0').error);
    assert.ok(parseMaxCost('51').error);
    assert.ok(parseMaxCost('-1').error);
  });

  test('步驟排序不改動原陣列，超出範圍不動', () => {
    const list = ['a', 'b', 'c'];
    assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(moveItem(list, 1, 0), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(list, 0, -1), ['a', 'b', 'c']);
    assert.deepEqual(moveItem(list, 2, 3), ['a', 'b', 'c']);
    assert.deepEqual(list, ['a', 'b', 'c']);
  });

  test('工作流驗證與輸出格式', () => {
    assert.match(validateWorkflow({ name: '', steps: [] }), /名稱/);
    assert.match(validateWorkflow({ name: '流程', steps: [] }), /至少/);
    assert.match(validateWorkflow({ name: '流程', steps: [{ agent: '', instructions: 'x' }] }), /第 1 步.*agent/);
    assert.match(validateWorkflow({ name: '流程', steps: [{ agent: 'coding', instructions: ' ' }] }), /第 1 步.*指示/);
    const draft = { name: ' 流程 ', steps: [{ _key: 's1', title: '', agent: 'coding', instructions: ' 寫 ' }] };
    assert.equal(validateWorkflow(draft), null);
    assert.deepEqual(workflowPayload(draft), { name: '流程', steps: [{ title: '步驟 1', agent: 'coding', instructions: '寫' }] });
    assert.equal(workflowPayload({ ...draft, id: 'w1' }).id, 'w1');
  });

  test('模型統計計算成功率與平均耗時，接受資料庫欄位', () => {
    const [row] = normalizeStats([{ provider: 'openai', model: 'm', agent_type: 'research', successes: 3, failures: 1, total_ms: 8000, cost_usd: 0.4 }]);
    assert.equal(row.rate, 0.75);
    assert.equal(row.avgMs, 2000);
    assert.equal(row.agent, 'research');
    assert.equal(row.costUsd, 0.4);
    assert.deepEqual(normalizeStats(null), []);
    assert.equal(normalizeStats([{ model: 'x' }])[0].rate, null);
  });
});
