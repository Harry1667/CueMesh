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
];

// 與 src/core/router.js 的 parseMentions 對齊：@claude 對應 anthropic
const PROVIDER_ALIASES = { claude: 'anthropic', openai: 'openai' };

export const MENTIONS = [
  { word: 'research', group: 'agent', label: AGENT_LABELS.research },
  { word: 'coding', group: 'agent', label: AGENT_LABELS.coding },
  { word: '3d', group: 'agent', label: AGENT_LABELS['3d'] },
  { word: 'vision', group: 'agent', label: AGENT_LABELS.vision },
  { word: 'review', group: 'agent', label: AGENT_LABELS.review },
  { word: 'browser', group: 'agent', label: AGENT_LABELS.browser },
  { word: 'claude', group: 'provider', label: '指定 Anthropic Claude' },
  { word: 'openai', group: 'provider', label: '指定 OpenAI' },
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
export function startBlocker({ goal, keyStatus, mode, workflowId, workflows = [], activeRunId, projectId, projectRemoteOnly = false }) {
  const connected = connectedProviders(keyStatus);
  if (activeRunId) return '目前有任務正在執行，完成或取消後才能開始新任務。';
  if (!projectId) return '還沒有可用的專案。';
  if (projectRemoteOnly) return '這個共享專案還沒有同步到這台裝置，目前只能派工到其他裝置。';
  if (connected.length === 0) return '先設定至少一家 AI 的 API key。';
  if (mode === 'council' && connected.length < 2) return 'AI 議會需要 Anthropic 與 OpenAI 兩家的 API key。';
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
    mesh: new Map(), // 跨裝置協作：key 是子任務，內容是派給哪台裝置與來回訊息
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
    case 'mesh_dispatch':
    case 'mesh_report':
    case 'mesh_question':
    case 'mesh_answer': {
      const key = p.taskId ?? deviceLabel(p.device) ?? 'unknown';
      let link = view.mesh.get(key);
      if (!link) {
        link = { key, taskId: p.taskId ?? null, device: null, owner: null, mine: null, status: 'pending', goal: null, costUsd: null, role: null, entries: [] };
        view.mesh.set(key, link);
      }
      if (p.device) link.device = p.device;
      if (p.owner) link.owner = p.owner;
      if (typeof p.mine === 'boolean') link.mine = p.mine;
      if (typeof p.status === 'string') link.status = p.status;
      if (typeof p.costUsd === 'number') link.costUsd = p.costUsd;
      // 主 agent 端有 mesh_dispatch；接到派工的裝置只有方向相反的提問與回答，這時這台才是子 agent
      if (event.type === 'mesh_dispatch') link.role = 'main';
      else if (!link.role && ((event.type === 'mesh_question' && p.direction === 'outgoing') || (event.type === 'mesh_answer' && p.direction === 'incoming'))) link.role = 'sub';
      if (event.type === 'mesh_dispatch' && p.text) link.goal = String(p.text);
      else if (p.text) {
        const kind = { mesh_report: 'report', mesh_question: 'question', mesh_answer: 'answer' }[event.type];
        if (kind) pushCapped(link.entries, { kind, text: String(p.text), at }, 50);
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

// ---------- 帳號與雲端 ----------

export const CLOUD_STATUS = {
  signed_out: { label: '未登入', lamp: 'off' },
  connecting: { label: '連線中', lamp: 'pending' },
  online: { label: '已連線', lamp: 'done' },
  offline: { label: '連不上伺服器，本機功能不受影響', lamp: 'warning' },
};

export const ACCEPT_REMOTE_OPTIONS = [
  { id: 'off', label: '不接受派工', risk: '最安全。別人和你的其他裝置都不能把任務派到這台。' },
  { id: 'ask', label: '每次都問我', risk: '建議。每次派工都跳同意視窗，你可以看過內容再決定。' },
  { id: 'auto', label: '自己的派工自動接受', risk: '風險較高。你的帳號被盜時，對方可以直接用這台瀏覽器和你的 API key。其他帳號的派工仍然一定會問。' },
];

// 只接受 http、https。伺服器會收到登入密碼，用 http 連到非本機位址時要警告
export function validateServerUrl(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return { error: '請輸入伺服器網址。' };
  const url = safeUrl(input);
  if (!url || url.startsWith('mailto:')) return { error: '網址要以 http:// 或 https:// 開頭。' };
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const clean = url.replace(/\/+$/, '');
  if (parsed.protocol === 'http:' && !local) {
    return { url: clean, warning: '這是未加密的 http 連線，登入密碼可能被同網路的人攔截。' };
  }
  return { url: clean };
}

export function validateCredentials({ mode, email, password, displayName }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim())) return '請輸入有效的電子郵件。';
  if (mode === 'register') {
    if (!String(displayName ?? '').trim()) return '請輸入顯示名稱，其他成員會看到它。';
    if (String(password ?? '').length < 10) return '密碼至少要 10 個字元。';
  } else if (!password) {
    return '請輸入密碼。';
  }
  return null;
}

export function validatePassphrase({ action, passphrase, confirm }) {
  if (!passphrase) return '請輸入密語。';
  if (action === 'push') {
    if (passphrase.length < 10) return '密語至少要 10 個字元。';
    if (passphrase !== confirm) return '兩次輸入的密語不一樣。密語無法找回，請再確認一次。';
  }
  return null;
}

export const deviceLabel = (device) => {
  if (!device) return null;
  if (typeof device === 'string') return stripControls(device);
  return stripControls(device.name ?? device.id ?? '') || null;
};

export function deviceOwner(device) {
  if (!device || typeof device !== 'object' || device.mine) return null;
  return device.ownerName ? stripControls(device.ownerName) : null;
}

// 引擎的事件把裝置名稱、擁有者分開放（device 是字串，owner、mine 是獨立欄位）
export function meshOwner(link) {
  if (link.mine === true) return null;
  if (link.owner) return stripControls(link.owner);
  return deviceOwner(link.device);
}

// 派工對象：線上、接受派工、不是這台。自己的裝置排前面，其他帳號的要能分辨
export function dispatchTargets(devices, thisDeviceId) {
  return (devices ?? [])
    .filter((d) => d.id !== thisDeviceId && d.online && d.acceptRemote !== 'off')
    .sort((a, b) => Number(Boolean(b.mine)) - Number(Boolean(a.mine)));
}

export function targetLabel(device) {
  const name = deviceLabel(device) ?? '未命名裝置';
  if (device.mine) return `${name}${device.acceptRemote === 'auto' ? '（自動接受）' : '（要在該裝置同意）'}`;
  return `${name}（${deviceOwner(device) ?? '其他帳號'}的裝置，要對方同意）`;
}

export function dispatchBlocker({ goal, signedIn, online, target, targets = [], mode, projectId }) {
  if (!signedIn) return '登入後才能把任務派給其他裝置。';
  if (!online) return '目前連不上伺服器，無法派工。';
  if (!projectId) return '還沒有可用的專案。';
  // 裝置離線時不可默默改在這台執行，使用者選的是對方的瀏覽器與 API key
  if (!targets.some((d) => d.id === target)) return '你選的裝置已離線或不再接受派工，請重新選擇。';
  if (mode === 'workflow') return '工作流只存在這台裝置，無法派工。';
  if (!String(goal ?? '').trim()) return '先寫下這次要做什麼。';
  return null;
}

// 派工內容會經過伺服器，規格不允許上傳截圖
export function dispatchContext(context) {
  let droppedImages = 0;
  const items = [];
  for (const item of context ?? []) {
    if (item.image) droppedImages += 1;
    if (!item.text) continue;
    items.push({ type: item.type, text: item.text, url: item.url, title: item.title });
  }
  return { items, droppedImages };
}

// 本機專案加上雲端專案。共享專案要標示；只在雲端的專案本機還沒有資料
export function mergeProjects(local, remote) {
  const remoteById = new Map((remote ?? []).map((p) => [p.id, p]));
  const isShared = (p) => p?.role === 'member' || Number(p?.memberCount ?? 0) > 1;
  const merged = (local ?? []).map((p) => {
    const r = remoteById.get(p.id);
    return { ...p, role: r?.role ?? null, shared: isShared(r), remoteOnly: false };
  });
  const known = new Set(merged.map((p) => p.id));
  for (const r of remote ?? []) {
    if (!known.has(r.id)) merged.push({ ...r, shared: isShared(r), remoteOnly: true });
  }
  return merged;
}

export function canRemoveMember({ member, myUserId, myRole }) {
  if (member.role === 'owner') return false; // 擁有者不能被移除，也不能自行退出
  return myRole === 'owner' || member.userId === myUserId;
}

export const DISPATCH_STATUS = {
  pending: { label: '等待對方接受', lamp: 'pending' },
  accepted: { label: '執行中', lamp: 'running' },
  running: { label: '執行中', lamp: 'running' },
  done: { label: '完成', lamp: 'done' },
  partial: { label: '部分完成', lamp: 'warning' },
  failed: { label: '失敗', lamp: 'failed' },
  rejected: { label: '已拒絕', lamp: 'failed' },
  cancelled: { label: '已取消', lamp: 'off' },
  expired: { label: '已逾期', lamp: 'off' },
};
export const dispatchStatus = (status) => DISPATCH_STATUS[status] ?? { label: String(status ?? '未知'), lamp: 'off' };
export const isDispatchOpen = (status) => status === 'pending' || status === 'accepted' || status === 'running';

export function mergeDispatches(incoming, outgoing) {
  const byId = new Map();
  for (const d of outgoing ?? []) byId.set(d.id, { ...d, direction: 'outgoing' });
  // 派給自己其他裝置時兩邊都有；在這台要顯示成發出，所以發出優先
  for (const d of incoming ?? []) if (!byId.has(d.id)) byId.set(d.id, { ...d, direction: 'incoming' });
  return [...byId.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// 伺服器沒明確說是同帳號，就當成其他帳號：寧可多一層警告
export const isCrossAccount = (dispatch) => dispatch?.crossAccount !== false;

// 預算取派工要求與本機設定的較小值（docs/cloud-api.md 的安全規則）
export function consentBudget(dispatch, localMax) {
  const values = [dispatch?.options?.maxCostUsd, localMax].filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return values.length ? Math.min(...values) : null;
}

// 同意佇列：與批准佇列相同的一次一個、排隊處理，回傳格式是 { accepted, reason? }
export function createConsentQueue() {
  const queue = createApprovalQueue();
  return {
    request: (dispatch) => queue.request({ ...dispatch, runId: dispatch.id }).then((answer) => {
      const result = { accepted: answer.approved };
      if (answer.note) result.reason = answer.note;
      return result;
    }),
    current: queue.current,
    waiting: queue.waiting,
    respond: queue.respond,
    // 派工被發起方取消或逾期時，不該繼續問使用者
    dismiss: (dispatchId, reason = '派工已結束') => queue.dismissRun(dispatchId, reason),
    dismissAll(reason = '已登出') {
      let current = queue.current();
      while (current) {
        queue.dismissRun(current.runId, reason);
        current = queue.current();
      }
    },
    subscribe: queue.subscribe,
  };
}

// 批准模式：其他帳號的派工要逐步批准，不受使用者的 risky 設定影響。
// 瀏覽器模組沒傳 runId 時無法分辨任務，只要有強制中的任務就一律用最嚴格的模式。
export function createApprovalPolicy(initialMode = 'always') {
  let mode = initialMode === 'risky' ? 'risky' : 'always';
  const forced = new Set();
  return {
    getApprovalMode({ runId } = {}) {
      if (runId === undefined || runId === null) return forced.size ? 'always' : mode;
      return forced.has(runId) ? 'always' : mode;
    },
    setMode(next) {
      mode = next === 'risky' ? 'risky' : 'always';
    },
    force: (runId) => {
      forced.add(runId);
    },
    release: (runId) => {
      forced.delete(runId);
    },
  };
}
