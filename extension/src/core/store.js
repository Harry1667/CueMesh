// 本機儲存：載入後在記憶體操作，並延遲寫回 chrome.storage.local。
// API key 也只存在這裡，不會傳給網站；chrome.storage 沒有加密，同一台電腦的其他程式可能讀得到，這點要在設定頁告知。
import { PROVIDERS, ROUTES } from './catalog.js';

const STATE_KEY = 'cuemesh.state.v1';
const KEYS_KEY = 'cuemesh.keys.v1';
const SAVE_DELAY_MS = 300;
const MAX_RUNS_PER_PROJECT = 50;
const MAX_EVENTS_PER_RUN = 2000;

const DEFAULT_SETTINGS = { approvalMode: 'always', maxCostUsd: 2, teamPrefs: {} };

const newId = () => globalThis.crypto.randomUUID();

// chrome.storage 的轉接；測試可換成 memoryKv
export function chromeKv(storage = globalThis.chrome.storage.local) {
  return {
    async get(key) { return (await storage.get(key))[key]; },
    async set(key, value) { await storage.set({ [key]: value }); },
  };
}

export function memoryKv(initial = {}) {
  const data = { ...initial };
  return { data, async get(key) { return data[key]; }, async set(key, value) { data[key] = structuredClone(value); } };
}

export async function createStore({ kv = chromeKv(), onError = (err) => console.error('CueMesh 儲存失敗', err) } = {}) {
  const saved = (await kv.get(STATE_KEY)) ?? {};
  const state = {
    projects: saved.projects ?? [],
    runs: saved.runs ?? [],
    workflows: saved.workflows ?? [],
    stats: saved.stats ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
  };
  let keys = (await kv.get(KEYS_KEY)) ?? {};

  // 瀏覽器重開或面板關閉後，執行中的工作不可能續跑，要明確標記為中斷
  for (const run of state.runs) {
    if (['planning', 'running'].includes(run.status)) {
      run.status = 'failed';
      run.error = '側邊面板已關閉，任務中斷';
      run.finishedAt = run.finishedAt ?? Date.now();
      for (const t of run.tasks) {
        if (['pending', 'running'].includes(t.status)) { t.status = 'failed'; t.error = '側邊面板已關閉，任務中斷'; }
      }
    }
  }

  let timer = null;
  const flush = async () => {
    timer = null;
    try {
      await kv.set(STATE_KEY, state);
    } catch (err) {
      onError(err);
    }
  };
  const schedule = () => { if (!timer) timer = setTimeout(flush, SAVE_DELAY_MS); };

  const findRun = (id) => state.runs.find((r) => r.id === id);
  const requireRun = (id) => {
    const run = findRun(id);
    if (!run) throw new Error(`找不到任務 ${id}`);
    return run;
  };
  const requireProject = (id) => {
    const project = state.projects.find((p) => p.id === id);
    if (!project) throw new Error(`找不到專案 ${id}`);
    return project;
  };

  return {
    flush,

    // ---- UI 使用的非同步介面（見 ARCHITECTURE.md）----
    async listProjects() { return structuredClone(state.projects); },
    async createProject({ name, description = '' }) {
      if (!name?.trim()) throw new Error('專案名稱不可空白');
      const project = { id: newId(), name: name.trim(), description, memory: '', createdAt: Date.now() };
      state.projects.push(project);
      schedule();
      return structuredClone(project);
    },
    async deleteProject(id) {
      state.projects = state.projects.filter((p) => p.id !== id);
      state.runs = state.runs.filter((r) => r.projectId !== id);
      schedule();
    },
    async listRuns(projectId) {
      return structuredClone(
        state.runs
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(({ events, context, ...rest }) => rest),
      );
    },
    async getKeyStatus() {
      return Object.fromEntries(PROVIDERS.map(({ id }) => [id, { set: Boolean(keys[id]), last4: keys[id]?.slice(-4) ?? null }]));
    },
    async setKey(provider, apiKey) {
      if (!PROVIDERS.some((p) => p.id === provider)) throw new Error(`未知的 AI 服務：${provider}`);
      const trimmed = apiKey?.trim();
      if (!trimmed) throw new Error('API key 不可空白');
      keys = { ...keys, [provider]: trimmed };
      await kv.set(KEYS_KEY, keys);
    },
    async removeKey(provider) {
      const { [provider]: _removed, ...rest } = keys;
      keys = rest;
      await kv.set(KEYS_KEY, keys);
    },
    async getSettings() { return structuredClone(state.settings); },
    async updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      schedule();
      return structuredClone(state.settings);
    },
    async listWorkflows() { return structuredClone(state.workflows); },
    async saveWorkflow({ id, name, steps }) {
      if (!name?.trim()) throw new Error('工作流名稱不可空白');
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('工作流至少要有一個步驟');
      for (const s of steps) {
        if (!ROUTES[s.agent]) throw new Error(`未知的 agent：${s.agent}`);
        if (!s.instructions?.trim()) throw new Error('每個步驟都要有工作內容');
      }
      const existing = state.workflows.find((w) => w.id === id);
      const workflow = { id: existing?.id ?? newId(), name: name.trim(), steps, createdAt: existing?.createdAt ?? Date.now() };
      state.workflows = [...state.workflows.filter((w) => w.id !== workflow.id), workflow];
      schedule();
      return structuredClone(workflow);
    },
    async deleteWorkflow(id) {
      state.workflows = state.workflows.filter((w) => w.id !== id);
      schedule();
    },
    async getStats() { return structuredClone(state.stats); },
    async getRun(id) {
      const run = findRun(id);
      return run ? structuredClone(run) : null;
    },

    // ---- 引擎使用的同步介面 ----
    keys: {
      get: (provider) => keys[provider],
      listProviders: () => PROVIDERS.map((p) => p.id).filter((id) => keys[id]),
    },
    requireProject,
    workflow: (id) => state.workflows.find((w) => w.id === id),
    settings: () => state.settings,
    statsFor: (agentType) => state.stats.filter((s) => s.agentType === agentType),
    insertRun(run) {
      requireProject(run.projectId);
      state.runs.push(run);
      // 超過保留數量時清最舊的已結束任務，避免碰到儲存上限
      const finished = state.runs.filter((r) => r.projectId === run.projectId && r.finishedAt).sort((a, b) => a.createdAt - b.createdAt);
      const excess = state.runs.filter((r) => r.projectId === run.projectId).length - MAX_RUNS_PER_PROJECT;
      if (excess > 0) {
        const removed = new Set(finished.slice(0, excess).map((r) => r.id));
        state.runs = state.runs.filter((r) => !removed.has(r.id));
      }
      schedule();
    },
    run: requireRun,
    touch: schedule,
    pushEvent(runId, event) {
      const run = requireRun(runId);
      run.events.push(event);
      if (run.events.length > MAX_EVENTS_PER_RUN) run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
      schedule();
    },
    upsertArtifact(runId, { name, kind, content, createdBy }) {
      const run = requireRun(runId);
      const existing = run.artifacts.find((a) => a.name === name);
      if (existing) {
        Object.assign(existing, { kind, content, createdBy, createdAt: Date.now() });
        schedule();
        return existing;
      }
      const artifact = { id: newId(), runId, name, kind, content, createdBy, createdAt: Date.now() };
      run.artifacts.push(artifact);
      schedule();
      return artifact;
    },
    recordStat({ provider, model, agentType, success, ms, costUsd }) {
      let row = state.stats.find((s) => s.provider === provider && s.model === model && s.agentType === agentType);
      if (!row) {
        row = { provider, model, agentType, successes: 0, failures: 0, totalMs: 0, costUsd: 0 };
        state.stats.push(row);
      }
      if (success) row.successes += 1; else row.failures += 1;
      row.totalMs += ms;
      row.costUsd += costUsd;
      schedule();
    },
  };
}
