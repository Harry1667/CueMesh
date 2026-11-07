// UI 的純邏輯：不碰 DOM，方便用 node:test 驗證。
// 事件資料來自核心引擎，內容可能含模型或網頁產生的文字，這裡只整理結構，不做任何 HTML 處理。
import { safeUrl } from './markdown.js';

export const AGENT_LABELS = {
  research: '查資料',
  coding: '寫程式',
  '3d': '3D 場景',
  vision: '看圖與截圖',
  planning: '拆解任務',
  review: '審查成果',
  browser: '操作瀏覽器',
};

export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic Claude', short: 'Claude', keyHint: '例如 sk-ant-…' },
  { id: 'openai', label: 'OpenAI', short: 'OpenAI', keyHint: '例如 sk-…' },
  { id: 'gemini', label: 'Google Gemini', short: 'Gemini', keyHint: '例如 AIza…' },
];

// 與 src/core/router.js 的 parseMentions 對齊：@claude 對應 anthropic
const PROVIDER_ALIASES = { claude: 'anthropic', openai: 'openai', gemini: 'gemini' };

export const MENTIONS = [
  { word: 'research', group: 'agent', label: AGENT_LABELS.research },
  { word: 'coding', group: 'agent', label: AGENT_LABELS.coding },
  { word: '3d', group: 'agent', label: AGENT_LABELS['3d'] },
  { word: 'vision', group: 'agent', label: AGENT_LABELS.vision },
  { word: 'review', group: 'agent', label: AGENT_LABELS.review },
  { word: 'browser', group: 'agent', label: AGENT_LABELS.browser },
  { word: 'claude', group: 'provider', label: '指定 Anthropic Claude' },
  { word: 'openai', group: 'provider', label: '指定 OpenAI' },
  { word: 'gemini', group: 'provider', label: '指定 Google Gemini' },
];

export const CONTEXT_KINDS = [
  { kind: 'selection', label: '反白文字', hint: '擷取目前分頁反白的文字', progress: '正在讀取反白文字…' },
  { kind: 'region', label: '框選區域', hint: '到頁面上拖曳框選，按 Esc 取消', progress: '請到頁面上拖曳框選區域，按 Esc 取消' },
  { kind: 'element', label: '指定元素', hint: '到頁面上點選一個元素，按 Esc 取消', progress: '請到頁面上點選一個元素，按 Esc 取消' },
  { kind: 'page', label: '整頁', hint: '分享這個分頁的整頁內容', progress: '正在讀取整頁內容…' },
];

export const RUN_STATUS_LABELS = {
  planning: '規劃中',
  running: '執行中',
  done: '完成',
  partial: '部分完成',
  failed: '失敗',
  cancelled: '已取消',
};

export const TASK_STATUS_LABELS = { pending: '等待中', running: '執行中', done: '完成', failed: '失敗' };

const TOOL_LABELS = {
  browser_snapshot: '讀取頁面',
  browser_screenshot: '截圖',
  browser_click: '點擊',
  browser_type: '輸入文字',
  browser_press_key: '按鍵',
  browser_scroll: '捲動',
  browser_navigate: '前往網址',
  browser_new_tab: '開新分頁',
  browser_wait: '等待',
  workspace_list: '列出工作區',
  workspace_read: '讀取工作區',
  workspace_write: '寫入工作區',
  delegate: '委派',
};

export const toolLabel = (tool) => TOOL_LABELS[tool] ?? String(tool ?? '未知動作');
export const isBrowserTool = (tool) => typeof tool === 'string' && tool.startsWith('browser_');
export const isFinished = (status) => ['done', 'partial', 'failed', 'cancelled'].includes(status);

// ---------- 格式化 ----------

export function formatUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `US$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function clip(value, max = 80) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// 控制字元與雙向文字覆寫符可以讓網址或按鈕文字「看起來」是別的內容，批准對話框不能被這樣騙
export function stripControls(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '');
}

export function describeArgs(tool, args) {
  const a = args && typeof args === 'object' ? args : {};
  switch (tool) {
    case 'browser_click':
      return a.ref ? `元素 ${clip(a.ref, 20)}` : '';
    case 'browser_type':
      return `「${clip(a.text, 60)}」${a.ref ? `到元素 ${clip(a.ref, 20)}` : ''}`;
    case 'browser_press_key':
      return clip(a.key, 30);
    case 'browser_scroll':
      return typeof a.pixels === 'number' ? `${a.pixels > 0 ? '往下' : '往上'} ${Math.abs(a.pixels)} 像素` : '';
    case 'browser_navigate':
    case 'browser_new_tab':
      return clip(a.url, 100);
    case 'browser_wait':
      return typeof a.seconds === 'number' ? `${a.seconds} 秒` : '';
    case 'workspace_read':
    case 'workspace_write':
      return clip(a.name, 60);
    case 'delegate':
      return a.agent ? `@${clip(a.agent, 20)}：${clip(a.request, 60)}` : '';
    default:
      return '';
  }
}

export function describeElement(element) {
  if (!element) return null;
  if (typeof element === 'string') return stripControls(element);
  if (typeof element !== 'object') return null;
  const role = element.role ?? element.tag ?? '';
  const name = element.name ?? element.text ?? element.label ?? '';
  const parts = [role && stripControls(role), name && `「${stripControls(clip(name, 120))}」`].filter(Boolean);
  return parts.length ? parts.join(' ') : element.ref ? `元素 ${stripControls(element.ref)}` : null;
}

export function describeUrl(raw) {
  if (!raw) return null;
  const full = stripControls(raw);
  try {
    const url = new URL(full);
    return { host: url.host || url.protocol, full };
  } catch {
    return { host: null, full };
  }
}

// 只有這幾種點陣圖可以當縮圖。SVG 不行：它可以帶指令碼
const THUMB_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export function imageDataUrl(image) {
  if (!image || !THUMB_TYPES.has(image.mediaType)) return null;
  if (typeof image.data !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(image.data)) return null;
  return `data:${image.mediaType};base64,${image.data}`;
}

export function safeFilename(name) {
  const cleaned = stripControls(name)
    .replace(/\.{2,}/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^[.\-\s]+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'cuemesh-成果.txt';
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------- @ 自動完成 ----------

// router.js 只認「開頭或空白後」的 @，所以這裡用同樣規則，避免選了卻不生效
export function findMentionQuery(text, caret) {
  const before = String(text ?? '').slice(0, caret);
  const match = /(?:^|\s)@([a-z0-9]*)$/i.exec(before);
  if (!match) return null;
  const query = match[1].toLowerCase();
  return { query, start: before.length - query.length - 1, end: caret };
}

export function filterMentions(query) {
  const q = String(query ?? '').toLowerCase();
  return MENTIONS.filter((m) => m.word.startsWith(q));
}

export function applyMention(text, match, word) {
  const source = String(text ?? '');
  const tail = source.slice(match.end);
  const insert = `@${word}${/^\s/.test(tail) ? '' : ' '}`;
  return { text: source.slice(0, match.start) + insert + tail, caret: match.start + insert.length };
}

export function mentionedProviders(goal) {
  const found = new Set();
  for (const match of String(goal ?? '').matchAll(/(?:^|\s)@([a-z0-9]+)\b/gi)) {
    const provider = PROVIDER_ALIASES[match[1].toLowerCase()];
    if (provider) found.add(provider);
  }
  return [...found];
}

export function connectedProviders(keyStatus) {
  return PROVIDERS.filter((p) => keyStatus?.[p.id]?.set).map((p) => p.id);
}

// 回傳不能開始的原因（給使用者看的文字）；可以開始時回 null
export function startBlocker({ goal, keyStatus, mode, workflowId, workflows = [], activeRunId, projectId }) {
  const connected = connectedProviders(keyStatus);
  if (activeRunId) return '目前有任務正在執行，完成或取消後才能開始新任務。';
  if (!projectId) return '還沒有可用的專案。';
  if (connected.length === 0) return '先設定至少一家 AI 的 API key。';
  if (mode === 'council' && connected.length < 2) return 'AI 議會需要至少兩家 AI 的 API key。';
  if (mode === 'workflow') {
    if (workflows.length === 0) return '還沒有工作流，請先到設定頁建立。';
    if (!workflows.some((w) => w.id === workflowId)) return '請選擇要執行的工作流。';
  }
  if (!String(goal ?? '').trim()) return '先寫下這次要做什麼。';
  for (const provider of mentionedProviders(goal)) {
    if (!connected.includes(provider)) {
      const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
      return `你指定了 ${label}，但還沒有設定它的 API key。`;
    }
  }
  return null;
}

export function buildStartOptions({ mode, workflowId, maxCostUsd }) {
  const options = {};
  if (mode === 'workflow') options.workflowId = workflowId;
  else options.mode = mode === 'council' ? 'council' : 'auto';
  if (typeof maxCostUsd === 'number' && Number.isFinite(maxCostUsd)) options.maxCostUsd = maxCostUsd;
  return options;
}

// ---------- Run 檢視模型 ----------

const FEED_LIMIT = 300;
const LOG_LIMIT = 300;

// 核心目前同時可能出現 camelCase（規格）與 snake_case（資料庫欄位），這裡統一成規格的寫法
const RUN_FIELD_MAP = {
  plan_summary: 'planSummary',
  final_result: 'finalResult',
  cost_usd: 'costUsd',
  input_tokens: 'inputTokens',
  output_tokens: 'outputTokens',
  created_at: 'createdAt',
  finished_at: 'finishedAt',
  project_id: 'projectId',
};
const TASK_FIELD_MAP = {
  parent_task_id: 'parentTaskId',
  agent_type: 'agent',
  agentType: 'agent',
  started_at: 'startedAt',
  finished_at: 'finishedAt',
  run_id: 'runId',
};

function normalizeFields(fields, map) {
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) out[map[key] ?? key] = value;
  return out;
}

function parseSources(value) {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => ({ title: typeof s?.title === 'string' ? s.title : '', url: safeUrl(s?.url) }))
    .filter((s) => s.url);
}

function normalizeTaskFields(fields) {
  const out = normalizeFields(fields, TASK_FIELD_MAP);
  if ('sources_json' in out) {
    out.sources = parseSources(out.sources_json);
    delete out.sources_json;
  } else if ('sources' in out) {
    out.sources = parseSources(out.sources);
  }
  return out;
}

function blankTask(id) {
  return {
    id, parentTaskId: null, title: '（未命名工作）', agent: null, status: 'pending', provider: null, model: null,
    result: null, sources: [], error: null, startedAt: null, finishedAt: null, position: 0,
    messages: [], fallbacks: [], mention: null,
  };
}

export function createRunView(seed = {}) {
  const run = normalizeFields(seed, RUN_FIELD_MAP);
  return {
    runId: seed.id ?? seed.runId ?? null,
    run: {
      goal: '', status: 'planning', mode: 'auto', planSummary: null, finalResult: null, error: null,
      costUsd: 0, inputTokens: 0, outputTokens: 0, createdAt: null, finishedAt: null,
      ...run,
    },
    context: seed.context ?? [],
    maxCostUsd: seed.maxCostUsd ?? null,
    plan: null,
    tasks: new Map(),
    feed: [],
    browserLog: [],
    artifacts: [],
    seen: new Set(),
    cancelling: false,
  };
}

function ensureTask(view, id) {
  let task = view.tasks.get(id);
  if (!task) {
    task = blankTask(id);
    view.tasks.set(id, task);
  }
  return task;
}

function pushCapped(list, item, limit) {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

// 把一個引擎事件套用到檢視模型。回傳 false 代表沒有變化（重複事件、未知類型、不屬於這個 Run）
export function applyEvent(view, event) {
  if (!event || typeof event !== 'object') return false;
  if (event.runId && view.runId && event.runId !== view.runId) return false;
  // 同一個 Run 內 seq 遞增，重試可能造成重複事件，要用 seq 去重
  if (typeof event.seq === 'number' && event.seq > 0) {
    if (view.seen.has(event.seq)) return false;
    view.seen.add(event.seq);
  }
  const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const at = event.createdAt ?? null;

  switch (event.type) {
    case 'run_update': {
      const fields = normalizeFields(p.fields, RUN_FIELD_MAP);
      Object.assign(view.run, fields);
      return true;
    }
    case 'plan': {
      view.plan = {
        summary: p.summary ?? '',
        tasks: Array.isArray(p.tasks) ? p.tasks : [],
        estimatedCostUsd: typeof p.estimatedCostUsd === 'number' ? p.estimatedCostUsd : null,
      };
      if (p.summary) view.run.planSummary = p.summary;
      return true;
    }
    case 'task_created': {
      if (!p.taskId) return false;
      const task = ensureTask(view, p.taskId);
      Object.assign(task, normalizeTaskFields({
        parentTaskId: p.parentTaskId ?? null,
        title: p.title ?? task.title,
        agent: p.agent ?? task.agent,
        position: p.position ?? task.position,
      }));
      return true;
    }
    case 'task_update': {
      if (!p.taskId) return false;
      Object.assign(ensureTask(view, p.taskId), normalizeTaskFields(p.fields));
      return true;
    }
    case 'agent_message': {
      if (p.taskId) pushCapped(ensureTask(view, p.taskId).messages, String(p.text ?? ''), 20);
      pushCapped(view.feed, { kind: 'message', at, taskId: p.taskId ?? null, text: String(p.text ?? '') }, FEED_LIMIT);
      return true;
    }
    case 'tool_call': {
      if (isBrowserTool(p.tool)) {
        pushCapped(view.browserLog, { at, taskId: p.taskId ?? null, tool: p.tool, args: p.args ?? {}, state: 'pending', error: null }, LOG_LIMIT);
      } else {
        pushCapped(view.feed, { kind: 'tool', at, taskId: p.taskId ?? null, tool: p.tool, args: p.args ?? {} }, FEED_LIMIT);
      }
      return true;
    }
    case 'browser_result': {
      const state = p.denied ? 'denied' : p.ok ? 'ok' : 'error';
      // 同一工具可能連續呼叫，要配對到最早還沒有結果的那一筆
      const entry = view.browserLog.find((e) => e.state === 'pending' && e.tool === p.tool && e.taskId === (p.taskId ?? null));
      if (entry) {
        entry.state = state;
        entry.error = p.error ?? null;
      } else {
        pushCapped(view.browserLog, { at, taskId: p.taskId ?? null, tool: p.tool, args: {}, state, error: p.error ?? null }, LOG_LIMIT);
      }
      return true;
    }
    case 'mention': {
      if (p.toTaskId) ensureTask(view, p.toTaskId).mention = { fromAgent: p.fromAgent ?? null, request: String(p.request ?? '') };
      pushCapped(view.feed, { kind: 'mention', at, fromAgent: p.fromAgent ?? null, agent: p.agent ?? null, request: String(p.request ?? '') }, FEED_LIMIT);
      return true;
    }
    case 'fallback': {
      const entry = { provider: p.provider ?? null, model: p.model ?? null, reason: String(p.reason ?? ''), stage: p.stage ?? null };
      if (p.taskId) ensureTask(view, p.taskId).fallbacks.push(entry);
      pushCapped(view.feed, { kind: 'fallback', at, taskId: p.taskId ?? null, ...entry }, FEED_LIMIT);
      return true;
    }
    case 'usage': {
      if (typeof p.totalCostUsd === 'number') view.run.costUsd = p.totalCostUsd;
      else if (typeof p.costUsd === 'number') view.run.costUsd = (view.run.costUsd ?? 0) + p.costUsd;
      if (typeof p.input === 'number') view.run.inputTokens = (view.run.inputTokens ?? 0) + p.input;
      if (typeof p.output === 'number') view.run.outputTokens = (view.run.outputTokens ?? 0) + p.output;
      return true;
    }
    case 'artifact': {
      const index = view.artifacts.findIndex((a) => a.id === p.artifactId || a.name === p.name);
      const entry = { id: p.artifactId, name: p.name ?? '未命名檔案', kind: p.kind ?? 'data', createdBy: p.createdBy ?? null };
      // 同名檔案會被覆寫；事件不含內容，舊內容先留著，等 getRun 補上最新版
      if (index >= 0) view.artifacts[index] = { ...view.artifacts[index], ...entry };
      else view.artifacts.push({ ...entry, content: null });
      return true;
    }
    case 'notice': {
      pushCapped(view.feed, { kind: 'notice', at, text: String(p.text ?? '') }, FEED_LIMIT);
      return true;
    }
    case 'run_finished': {
      view.run.status = p.status ?? view.run.status;
      if (p.error) view.run.error = p.error;
      if (!view.run.finishedAt) view.run.finishedAt = at;
      view.cancelling = false;
      // 任務已結束就不會再有結果，還卡在等待中的瀏覽器動作要標記出來，不能永遠顯示「等待中」
      for (const entry of view.browserLog) {
        if (entry.state === 'pending') entry.state = 'abandoned';
      }
      return true;
    }
    default:
      return false; // 未知事件不丟錯，舊版 UI 才能相容新版核心
  }
}

// 把 engine.getRun 的完整資料併入檢視模型（事件不帶成果內容，要靠這一步補齊）
export function mergeRun(view, run) {
  if (!run) return view;
  const { tasks, artifacts, events, context, ...rest } = run;
  if (Array.isArray(events)) for (const event of events) applyEvent(view, event);
  const fields = normalizeFields(rest, RUN_FIELD_MAP);
  // 較舊的快照晚到時，不能把已結束的任務改回執行中
  if (isFinished(view.run.status) && !isFinished(fields.status)) delete fields.status;
  Object.assign(view.run, fields);
  // 儲存的情境沒有截圖（引擎不存圖片），記憶體裡已有完整版本時不可被蓋掉
  if (Array.isArray(context) && !view.context?.length) view.context = context;
  if (Array.isArray(tasks)) {
    for (const raw of tasks) {
      if (!raw?.id) continue;
      Object.assign(ensureTask(view, raw.id), normalizeTaskFields(raw));
    }
  }
  if (Array.isArray(artifacts)) {
    for (const raw of artifacts) {
      const a = normalizeFields(raw, { created_by: 'createdBy', created_at: 'createdAt' });
      const index = view.artifacts.findIndex((x) => x.id === a.id || x.name === a.name);
      if (index >= 0) view.artifacts[index] = { ...view.artifacts[index], ...a };
      else view.artifacts.push({ createdBy: null, ...a });
    }
  }
  return view;
}

// 依委派關係排成樹；parentTaskId 指向不存在或形成循環時退回最上層，不能讓畫面無窮遞迴或吃掉任務
export function taskTree(view) {
  const tasks = [...view.tasks.values()];
  const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0);
  const byParent = new Map();
  const roots = [];
  const hasCycle = (task) => {
    const seen = new Set([task.id]);
    let current = task;
    while (current?.parentTaskId) {
      if (seen.has(current.parentTaskId)) return true;
      seen.add(current.parentTaskId);
      current = view.tasks.get(current.parentTaskId);
    }
    return false;
  };
  for (const task of tasks) {
    if (task.parentTaskId && view.tasks.has(task.parentTaskId) && !hasCycle(task)) {
      if (!byParent.has(task.parentTaskId)) byParent.set(task.parentTaskId, []);
      byParent.get(task.parentTaskId).push(task);
    } else {
      roots.push(task);
    }
  }
  const build = (task) => ({ task, children: (byParent.get(task.id) ?? []).sort(byPosition).map(build) });
  return roots.sort(byPosition).map(build);
}

export function taskProgress(view) {
  const tasks = [...view.tasks.values()];
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    running: tasks.filter((t) => t.status === 'running').length,
  };
}

export function collectSources(view) {
  const seen = new Map();
  for (const task of view.tasks.values()) {
    for (const source of task.sources ?? []) {
      if (source.url && !seen.has(source.url)) seen.set(source.url, source);
    }
  }
  return [...seen.values()];
}

// 重試時帶回原本的情境。歷史任務的截圖沒有保存，只剩標記的項目帶回去也沒有內容，要明確告知使用者
export function retryContext(context) {
  const items = [];
  let droppedImages = 0;
  for (const item of context ?? []) {
    const lostImage = item.hasImage && !item.image;
    if (lostImage) droppedImages += 1;
    if (item.image || item.text) items.push(item);
  }
  return { items, droppedImages };
}

export function normalizeRunRow(row) {
  const r = normalizeFields(row, RUN_FIELD_MAP);
  return {
    id: r.id, goal: r.goal ?? '', status: r.status ?? 'done', mode: r.mode ?? 'auto',
    costUsd: typeof r.costUsd === 'number' ? r.costUsd : null,
    createdAt: r.createdAt ?? null, finishedAt: r.finishedAt ?? null,
  };
}

// ---------- 批准佇列 ----------

// 一次只處理一個批准請求，其他排隊。瀏覽器模組呼叫 request 後會一直等到使用者回應。
export function createApprovalQueue() {
  const queue = [];
  const listeners = new Set();
  const notify = () => {
    for (const fn of listeners) fn(queue[0]?.request ?? null, Math.max(queue.length - 1, 0));
  };
  return {
    request(request) {
      return new Promise((resolve) => {
        queue.push({ request, resolve });
        notify(); // 不是第一個時，排隊數量也變了，畫面一樣要更新
      });
    },
    current: () => queue[0]?.request ?? null,
    waiting: () => Math.max(queue.length - 1, 0),
    respond(approved, note) {
      const head = queue.shift();
      if (!head) return false;
      const decision = { approved: Boolean(approved) };
      if (note) decision.note = note;
      head.resolve(decision);
      notify();
      return true;
    },
    // 任務結束或取消時，它還在排隊的請求一律視為拒絕，瀏覽器模組才不會永遠等下去
    dismissRun(runId, note = '任務已結束') {
      let removed = 0;
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i].request?.runId === runId) {
          queue[i].resolve({ approved: false, note });
          queue.splice(i, 1);
          removed += 1;
        }
      }
      if (removed) notify();
      return removed;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------- 設定頁 ----------

export function parseMaxCost(input) {
  const value = Number(String(input ?? '').trim());
  if (!String(input ?? '').trim() || !Number.isFinite(value)) return { error: '請輸入數字，例如 2。' };
  if (value < 0.01 || value > 50) return { error: '預算上限要介於 US$0.01 到 US$50 之間。' };
  return { value };
}

export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function validateWorkflow(draft) {
  if (!String(draft?.name ?? '').trim()) return '請幫工作流取個名稱。';
  const steps = draft.steps ?? [];
  if (steps.length === 0) return '工作流至少要有一個步驟。';
  for (const [i, step] of steps.entries()) {
    if (!step.agent) return `第 ${i + 1} 步還沒有選 agent。`;
    if (!String(step.instructions ?? '').trim()) return `第 ${i + 1} 步還沒有寫指示。`;
  }
  return null;
}

export function workflowPayload(draft) {
  const payload = {
    name: draft.name.trim(),
    steps: draft.steps.map((s, i) => ({
      title: String(s.title ?? '').trim() || `步驟 ${i + 1}`,
      agent: s.agent,
      instructions: s.instructions.trim(),
    })),
  };
  if (draft.id) payload.id = draft.id;
  return payload;
}

export function normalizeStats(stats) {
  const rows = Array.isArray(stats) ? stats : Array.isArray(stats?.rows) ? stats.rows : [];
  return rows
    .map((row) => {
      const successes = Number(row.successes ?? row.success ?? 0);
      const failures = Number(row.failures ?? row.failure ?? row.failed ?? 0);
      const attempts = successes + failures;
      const totalMs = Number(row.totalMs ?? row.total_ms ?? 0);
      return {
        provider: row.provider ?? '', model: row.model ?? '未知模型', agent: row.agent ?? row.agentType ?? row.agent_type ?? '',
        successes, failures, attempts,
        rate: attempts ? successes / attempts : null,
        avgMs: attempts ? totalMs / attempts : null,
        costUsd: Number(row.costUsd ?? row.cost_usd ?? 0),
      };
    })
    .sort((a, b) => b.attempts - a.attempts);
}
