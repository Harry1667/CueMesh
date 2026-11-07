// 側邊面板主程式：管理狀態、接引擎事件、切換畫面。
// 依賴全部由參數傳入（engine、store、browser），dev.html 與測試才能換成假物件。
import { h, sealMark } from './dom.js';
import {
  applyEvent, buildStartOptions, connectedProviders, createApprovalQueue, createRunView, isFinished, mergeRun,
  normalizeRunRow, PROVIDERS, retryContext, RUN_STATUS_LABELS, startBlocker,
} from './logic.js';
import { createApprovalDialog } from './view-approval.js';
import { createHistoryView } from './view-history.js';
import { createRunScreen } from './view-run.js';
import { createSettingsView } from './view-settings.js';
import { createTaskView } from './view-task.js';

const THEME_KEY = 'cuemesh.theme';
const PROJECT_KEY = 'cuemesh.projectId';
const DEFAULT_SETTINGS = { approvalMode: 'always', maxCostUsd: 2, teamPrefs: {} };
const NAV = [
  { id: 'task', label: '任務' },
  { id: 'history', label: '歷史' },
  { id: 'settings', label: '設定' },
];

// localStorage 只放視覺偏好與上次的專案，隱私視窗可能丟例外，所以都包起來；失敗也不影響功能
function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 只是偏好設定存不下來，下次開啟回到預設即可
  }
}

export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
}

const errorText = (err) => (err instanceof Error ? err.message : String(err ?? '未知錯誤'));

export function mountApp(root, deps = {}) {
  const { engine, store, browser, catalog = {}, previewUrl = null, onSettingsChange = null } = deps;
  if (!engine || !store || !browser) throw new Error('mountApp 需要 engine、store、browser');
  const approvals = deps.approvals ?? createApprovalQueue();

  const S = {
    view: 'task',
    loading: true,
    loadError: null,
    projects: [],
    projectId: null,
    keyStatus: {},
    settings: { ...DEFAULT_SETTINGS },
    workflows: [],
    runs: [],
    runsError: null,
    themePref: readPref(THEME_KEY) ?? 'system',
    goal: '',
    context: [],
    mode: 'auto',
    workflowId: null,
    capturing: null,
    captureNote: null,
    startError: null,
    starting: false,
    activeRunId: null,
    shownRunId: null,
    runViews: new Map(),
    openDetails: new Set(),
    openPreviews: new Set(),
    addingProject: false,
    projectError: null,
    toast: null,
  };

  applyTheme(S.themePref);

  // ---------- 畫面更新排程 ----------
  // 事件可能一次來很多筆，合併成一次更新。用計時器而非 requestAnimationFrame：面板在背景時後者會暫停，任務狀態就跟不上
  let renderTimer = null;
  let unmounted = false;
  const render = () => {
    if (renderTimer || unmounted) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!unmounted) paint();
    }, 16);
  };

  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const announce = (text) => {
    live.textContent = '';
    // 下一輪才寫入，同樣的文字連續出現時螢幕閱讀器才會再唸一次
    setTimeout(() => {
      live.textContent = text;
    }, 30);
  };

  const notify = (message, kind = 'error') => {
    S.toast = { message, kind };
    render();
  };

  // ---------- 資料讀取 ----------
  async function refreshKeys() {
    S.keyStatus = (await store.getKeyStatus()) ?? {};
    render();
  }

  async function refreshRuns() {
    if (!S.projectId) {
      S.runs = [];
      render();
      return;
    }
    try {
      const rows = await store.listRuns(S.projectId);
      S.runs = (rows ?? []).map(normalizeRunRow);
      S.runsError = null;
    } catch (err) {
      S.runsError = `讀取任務歷史失敗：${errorText(err)}`;
    }
    render();
  }

  async function refreshWorkflows() {
    S.workflows = (await store.listWorkflows()) ?? [];
    if (S.workflowId && !S.workflows.some((w) => w.id === S.workflowId)) S.workflowId = null;
    if (!S.workflowId && S.workflows.length) S.workflowId = S.workflows[0].id;
    render();
  }

  async function init() {
    try {
      const [projects, keyStatus, settings, workflows] = await Promise.all([
        store.listProjects(), store.getKeyStatus(), store.getSettings(), store.listWorkflows(),
      ]);
      S.keyStatus = keyStatus ?? {};
      S.settings = { ...DEFAULT_SETTINGS, ...settings, teamPrefs: { ...(settings?.teamPrefs ?? {}) } };
      S.workflows = workflows ?? [];
      if (S.workflows.length) S.workflowId = S.workflows[0].id;
      S.projects = projects ?? [];
      // 任務一定要屬於某個專案，第一次使用時自動建好，不要讓使用者先做這件無關的事
      if (S.projects.length === 0) S.projects = [await store.createProject({ name: '我的專案', description: '' })];
      const remembered = readPref(PROJECT_KEY);
      S.projectId = S.projects.some((p) => p.id === remembered) ? remembered : S.projects[0].id;
      onSettingsChange?.(S.settings);
      S.loading = false;
      await refreshRuns();
    } catch (err) {
      S.loading = false;
      S.loadError = errorText(err);
    }
    render();
  }

  // ---------- 動作 ----------
  const actions = {
    navigate(view) {
      S.view = view;
      S.toast = null;
      if (view === 'history') refreshRuns();
      render();
      main.scrollTop = 0;
    },

    openSettings(anchor) {
      actions.navigate('settings');
      setTimeout(() => settingsView.focusSection?.(anchor), 40);
    },

    async selectProject(id) {
      S.projectId = id;
      writePref(PROJECT_KEY, id);
      await refreshRuns();
    },

    async createProject(name) {
      const clean = name.trim();
      if (!clean) {
        S.projectError = '請輸入專案名稱。';
        render();
        return;
      }
      try {
        const project = await store.createProject({ name: clean, description: '' });
        S.projects = [...S.projects, project];
        S.addingProject = false;
        S.projectError = null;
        await actions.selectProject(project.id);
        announce(`已建立專案 ${clean}`);
      } catch (err) {
        S.projectError = `建立專案失敗：${errorText(err)}`;
        render();
      }
    },

    async deleteProject(id) {
      try {
        await store.deleteProject(id);
        S.projects = S.projects.filter((p) => p.id !== id);
        if (S.projects.length === 0) S.projects = [await store.createProject({ name: '我的專案', description: '' })];
        await actions.selectProject(S.projects[0].id);
      } catch (err) {
        notify(`刪除專案失敗：${errorText(err)}`);
      }
    },

    async addContext(kind, meta) {
      if (S.capturing) return;
      S.capturing = kind;
      S.captureNote = { text: meta.progress, kind: 'info' };
      render();
      try {
        const item = await browser.captureContext(kind, {});
        if (item) {
          S.context = [...S.context, item];
          S.captureNote = null;
          announce(`已附加情境：${meta.label}`);
        } else {
          S.captureNote = { text: `已取消${meta.label}。`, kind: 'info' };
        }
      } catch (err) {
        S.captureNote = { text: `無法擷取${meta.label}：${errorText(err)}`, kind: 'error' };
      } finally {
        S.capturing = null;
        render();
      }
    },

    removeContext(index) {
      S.context = S.context.filter((_, i) => i !== index);
      render();
    },

    setGoal(goal) {
      S.goal = goal;
      S.startError = null;
      render();
    },

    setMode(mode) {
      S.mode = mode;
      render();
    },

    setWorkflow(id) {
      S.workflowId = id;
      render();
    },

    async start() {
      if (S.starting) return;
      if (startBlocker(blockerInput())) return;
      S.starting = true;
      S.startError = null;
      render();
      const goal = S.goal.trim();
      const context = S.context;
      const maxCostUsd = S.settings.maxCostUsd;
      try {
        const runId = await engine.start({
          projectId: S.projectId,
          goal,
          context,
          options: buildStartOptions({ mode: S.mode, workflowId: S.workflowId, maxCostUsd }),
        });
        // 事件可能比 start 的回傳更早到，檢視模型或許已經存在
        const view = ensureRunView(runId);
        view.run.goal = goal;
        view.run.mode = S.mode;
        view.context = context;
        view.maxCostUsd = maxCostUsd;
        if (!view.run.createdAt) view.run.createdAt = Date.now();
        // 任務可能在 start 回傳前就結束了，已結束就不算執行中
        S.activeRunId = isFinished(view.run.status) ? null : runId;
        S.shownRunId = runId;
        S.goal = '';
        S.context = [];
        S.captureNote = null;
        taskView.clearGoal();
        S.view = 'run';
        main.scrollTop = 0;
        announce('任務已開始');
      } catch (err) {
        S.startError = `無法開始任務：${errorText(err)}`;
      } finally {
        S.starting = false;
        render();
      }
    },

    async cancel(runId) {
      const view = S.runViews.get(runId);
      if (view) view.cancelling = true;
      // 先拒絕這個任務還在排隊的批准，瀏覽器模組才不會繼續等
      approvals.dismissRun(runId, '使用者取消了任務');
      render();
      try {
        const accepted = await engine.cancel(runId);
        // 引擎回 false 代表任務已不在執行，不會再有 run_finished 事件，不能一直顯示「取消中」
        if (accepted === false && view) view.cancelling = false;
        else announce('正在取消任務');
        render();
      } catch (err) {
        if (view) view.cancelling = false;
        notify(`取消失敗：${errorText(err)}`);
      }
    },

    async openRun(runId) {
      S.shownRunId = runId;
      S.view = 'run';
      main.scrollTop = 0;
      render();
      await syncRun(runId, { replay: true });
    },

    showActiveRun() {
      S.shownRunId = S.activeRunId;
      S.view = 'run';
      main.scrollTop = 0;
      render();
    },

    // 失敗後想再試：帶回原本的目標與情境，讓使用者可以修改
    retry(view) {
      const { items, droppedImages } = retryContext(view.context);
      S.goal = view.run.goal ?? '';
      S.context = items;
      S.mode = ['auto', 'council', 'workflow'].includes(view.run.mode) ? view.run.mode : 'auto';
      S.captureNote = droppedImages
        ? { text: `原本的 ${droppedImages} 張截圖沒有保存，需要的話請重新擷取。`, kind: 'info' }
        : null;
      taskView.setGoal(S.goal);
      actions.navigate('task');
      taskView.focusGoal();
    },

    // 給外部來源用（右鍵選單選取的文字）：內容一樣視為不可信，只會顯示成文字
    addContextItem(item) {
      if (!item) return;
      S.context = [...S.context, item];
      if (S.view !== 'task') actions.navigate('task');
      render();
      announce('已附加右鍵選取的文字');
    },

    newTask() {
      actions.navigate('task');
      taskView.focusGoal();
    },

    async saveKey(provider, apiKey) {
      await store.setKey(provider, apiKey);
      await refreshKeys();
      announce('API key 已儲存');
    },

    async removeKey(provider) {
      await store.removeKey(provider);
      await refreshKeys();
      announce('API key 已移除');
    },

    async updateSettings(patch) {
      const saved = await store.updateSettings(patch);
      S.settings = { ...S.settings, ...patch, ...(saved && typeof saved === 'object' ? saved : {}) };
      onSettingsChange?.(S.settings);
      render();
    },

    setTheme(pref) {
      S.themePref = pref;
      writePref(THEME_KEY, pref === 'system' ? null : pref);
      applyTheme(pref);
      render();
    },

    async saveWorkflow(payload) {
      const saved = await store.saveWorkflow(payload);
      await refreshWorkflows();
      return saved;
    },

    async deleteWorkflow(id) {
      await store.deleteWorkflow(id);
      await refreshWorkflows();
    },

    getStats: () => store.getStats(),
    toggleDetail(key, open) {
      if (open) S.openDetails.add(key);
      else S.openDetails.delete(key);
    },
    togglePreview(key) {
      if (S.openPreviews.has(key)) S.openPreviews.delete(key);
      else S.openPreviews.add(key);
      render();
    },
    dismissToast() {
      S.toast = null;
      render();
    },
    notify,
    announce,
  };

  const blockerInput = () => ({
    goal: S.goal, keyStatus: S.keyStatus, mode: S.mode, workflowId: S.workflowId,
    workflows: S.workflows, activeRunId: S.activeRunId, projectId: S.projectId,
  });

  function ensureRunView(runId) {
    let view = S.runViews.get(runId);
    if (!view) {
      view = createRunView({ id: runId });
      view.maxCostUsd = S.settings.maxCostUsd;
      S.runViews.set(runId, view);
    }
    return view;
  }

  // 事件不帶成果內容與最終全文，用 getRun 補上；失敗要讓使用者知道，不能默默少東西
  async function syncRun(runId, { replay = false } = {}) {
    try {
      const run = await engine.getRun(runId);
      const view = ensureRunView(runId);
      if (!run && replay) {
        notify('找不到這筆任務紀錄。');
        return;
      }
      mergeRun(view, run);
      render();
    } catch (err) {
      notify(`讀取任務內容失敗：${errorText(err)}`);
    }
  }

  const syncTimers = new Map();
  function scheduleSync(runId) {
    if (syncTimers.has(runId)) return;
    syncTimers.set(runId, setTimeout(() => {
      syncTimers.delete(runId);
      syncRun(runId);
    }, 120));
  }

  function onEngineEvent(event) {
    if (!event?.runId) return;
    const view = ensureRunView(event.runId);
    const before = view.run.status;
    if (!applyEvent(view, event)) return;

    if (event.type === 'artifact') scheduleSync(event.runId);
    if (event.type === 'run_finished') {
      if (S.activeRunId === event.runId) S.activeRunId = null;
      approvals.dismissRun(event.runId, '任務已結束');
      scheduleSync(event.runId);
      refreshRuns();
      const status = view.run.status;
      if (status !== before || isFinished(status)) announce(`任務${RUN_STATUS_LABELS[status] ?? '已結束'}`);
    }
    if (event.type === 'task_update' && event.payload?.fields?.status === 'failed') announce('有子任務失敗');
    if (event.type === 'fallback') announce('改用備援模型');
    render();
  }

  // ---------- 外殼 ----------
  const lamps = h('div', { class: 'keylamps', role: 'img' });
  const projectSelect = h('select', {
    id: 'project-select',
    class: 'select select--bare',
    'aria-label': '目前專案',
    onChange: (e) => actions.selectProject(e.target.value),
  });
  const addProjectBtn = h('button', {
    type: 'button',
    class: 'iconbtn',
    'aria-label': '新增專案',
    title: '新增專案',
    onClick: () => {
      S.addingProject = !S.addingProject;
      S.projectError = null;
      render();
      if (S.addingProject) setTimeout(() => projectNameInput.focus(), 30);
    },
  }, '＋');
  const projectNameInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: '60',
    placeholder: '專案名稱',
    'aria-label': '新專案名稱',
  });
  const projectError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const projectForm = h('form', {
    class: 'project-form',
    hidden: true,
    onSubmit: async (e) => {
      e.preventDefault();
      await actions.createProject(projectNameInput.value);
      if (!S.projectError) projectNameInput.value = '';
    },
  },
  h('div', { class: 'row' },
    projectNameInput,
    h('button', { type: 'submit', class: 'btn btn--ink' }, '建立'),
    h('button', {
      type: 'button',
      class: 'btn btn--quiet',
      onClick: () => {
        S.addingProject = false;
        S.projectError = null;
        render();
        addProjectBtn.focus();
      },
    }, '取消')),
  projectError);

  const navButtons = new Map(NAV.map((item) => [item.id, h('button', {
    type: 'button',
    class: 'nav__item',
    onClick: () => actions.navigate(item.id),
  }, item.label)]));

  const header = h('header', { class: 'masthead' },
    h('div', { class: 'masthead__top' },
      h('h1', { class: 'brand' }, sealMark(), h('span', { class: 'brand__name' }, 'CueMesh')),
      h('nav', { class: 'nav', 'aria-label': '主要頁面' }, [...navButtons.values()])),
    h('div', { class: 'masthead__project' },
      h('label', { class: 'masthead__label', for: 'project-select' }, '專案'),
      projectSelect,
      addProjectBtn,
      lamps),
    projectForm);

  const main = h('main', { class: 'sheet', id: 'main', tabindex: '-1' });
  const toastEl = h('div', { class: 'toast', hidden: true });

  const ctx = { S, actions, catalog, previewUrl, blockerInput };
  const taskView = createTaskView(ctx);
  const runScreen = createRunScreen(ctx);
  const historyView = createHistoryView(ctx);
  const settingsView = createSettingsView(ctx);
  const views = { task: taskView, run: runScreen, history: historyView, settings: settingsView };
  for (const view of Object.values(views)) {
    view.el.hidden = true;
    main.appendChild(view.el);
  }

  const loading = h('p', { class: 'loading' }, '正在開啟提示本…');
  const loadErrorEl = h('div', { class: 'callout callout--danger', role: 'alert', hidden: true });
  main.prepend(loading, loadErrorEl);

  const approvalDialog = createApprovalDialog(approvals, { announce, onCancelRun: actions.cancel });
  root.replaceChildren(h('div', { class: 'app' }, header, main, toastEl, live, approvalDialog.el));

  function paintLamps() {
    const connected = connectedProviders(S.keyStatus);
    lamps.setAttribute('aria-label', connected.length
      ? `已接上 ${connected.length} 家 AI：${connected.map((id) => PROVIDERS.find((p) => p.id === id).short).join('、')}`
      : '還沒有接上任何 AI');
    lamps.replaceChildren(...PROVIDERS.map((p) => h('span', {
      class: `keylamp${connected.includes(p.id) ? ' is-on' : ''}`,
      title: `${p.label}：${connected.includes(p.id) ? '已設定' : '未設定'}`,
    })));
  }

  function paintProjects() {
    const options = S.projects.map((p) => h('option', { value: p.id, selected: p.id === S.projectId }, p.name));
    // 專案名稱沒變就不重建，鍵盤正在選的時候才不會被打斷
    const signature = JSON.stringify(S.projects.map((p) => [p.id, p.name]));
    if (projectSelect.dataset.sig !== signature) {
      projectSelect.replaceChildren(...options);
      projectSelect.dataset.sig = signature;
    }
    if (S.projectId) projectSelect.value = S.projectId;
    projectForm.hidden = !S.addingProject;
    addProjectBtn.setAttribute('aria-expanded', String(S.addingProject));
    projectError.hidden = !S.projectError;
    projectError.textContent = S.projectError ?? '';
  }

  function paint() {
    loading.hidden = !S.loading;
    loadErrorEl.hidden = !S.loadError;
    if (S.loadError) {
      loadErrorEl.replaceChildren(
        h('strong', null, '無法開啟 CueMesh'),
        h('p', null, S.loadError),
        h('button', {
          type: 'button',
          class: 'btn btn--ink',
          onClick: () => {
            S.loadError = null;
            S.loading = true;
            render();
            init();
          },
        }, '重新載入'),
      );
    }

    paintLamps();
    paintProjects();

    // 「執行畫面」屬於任務分頁
    const navView = S.view === 'run' ? 'task' : S.view;
    for (const [id, button] of navButtons) {
      if (id === navView) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }

    const ready = !S.loading && !S.loadError;
    for (const [id, view] of Object.entries(views)) {
      const visible = ready && id === S.view;
      const wasHidden = view.el.hidden;
      view.el.hidden = !visible;
      if (visible) view.update(wasHidden);
    }

    toastEl.hidden = !S.toast;
    if (S.toast) {
      toastEl.setAttribute('role', S.toast.kind === 'error' ? 'alert' : 'status');
      toastEl.dataset.kind = S.toast.kind;
      toastEl.replaceChildren(
        h('span', { class: 'toast__text' }, S.toast.message),
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': '關閉提示', onClick: actions.dismissToast }, '×'),
      );
    }
  }

  const unsubscribe = engine.subscribe(onEngineEvent);
  // 只有執行畫面需要每秒更新時鐘
  const clock = setInterval(() => {
    if (S.view === 'run') runScreen.tick();
  }, 1000);

  render();
  init();

  return {
    approvals,
    requestApproval: approvals.request,
    navigate: actions.navigate,
    openRun: actions.openRun,
    setGoal: (goal) => {
      S.goal = goal;
      taskView.setGoal(goal);
      render();
    },
    start: actions.start,
    addContextItem: actions.addContextItem,
    notify: actions.notify,
    ready: async () => {
      while (S.loading) await new Promise((resolve) => setTimeout(resolve, 10));
    },
    unmount() {
      unmounted = true;
      unsubscribe?.();
      clearInterval(clock);
      clearTimeout(renderTimer);
      for (const timer of syncTimers.values()) clearTimeout(timer);
      approvalDialog.destroy();
      root.replaceChildren();
    },
  };
}
