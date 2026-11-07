// 本機任務同步：雲端失敗時只排隊，不會干擾引擎或本機專案。
import { CLOUD_SYNC_QUEUE_KEY } from './index.js';

const MAX_EVENT_BATCH = 200;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function privateField(name, parent) {
  if (/^(api_?keys?|authorization|passwords?|secrets?|access_?tokens?|refresh_?tokens?|tokens?|key)$/i.test(name)) return true;
  // API key 物件不能只靠外層欄位名稱判斷；目前支援的兩個供應商也要排除。
  return parent === 'keys' && ['anthropic', 'openai'].includes(String(name).toLowerCase());
}

function imageField(name, value) {
  return /screenshot|image/i.test(name) || (value && typeof value === 'object' && typeof value.mediaType === 'string' && /^image\//.test(value.mediaType));
}

// 同步前深度複製並清除金鑰、截圖、data URL；絕不修改本機資料。
export function safeCloudData(value, field = '') {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeCloudData(item, field)).filter((item) => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (privateField(key, field) || imageField(key, item)) continue;
    const next = safeCloudData(item, key);
    if (next !== undefined) clean[key] = next;
  }
  return clean;
}

function byteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function remoteRun(run, deviceId) {
  const { context: _context, events: _events, artifacts: _artifacts, ...rest } = run;
  return safeCloudData({ ...rest, tasks: run.tasks ?? [], deviceId });
}

export function createSync({ cloud, engine, store, kv = cloud?.storage, queueKey = CLOUD_SYNC_QUEUE_KEY } = {}) {
  if (!cloud || !engine || !store) throw new Error('createSync 需要 cloud、engine 與 store');
  const storage = kv ?? {
    async get() { return []; },
    async set() {},
  };
  let queue = [];
  let started = false;
  let flushing = null;
  let offEngine = null;
  let offCloud = null;
  let startTask = null;
  const syncedProjects = new Set();

  const persist = async () => {
    await storage.set(queueKey, queue);
  };
  const send = async (item) => {
    if (item.type === 'project') return cloud.putProject(item.project);
    if (item.type === 'run') return cloud.putRun(item.run);
    if (item.type === 'events') return cloud.postRunEvents(item.runId, item.events);
    if (item.type === 'artifact') return cloud.putArtifact(item.runId, item.artifact);
    throw new Error('未知的同步項目');
  };
  const flush = async () => {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length) {
        try {
          await send(queue[0]);
        } catch (error) {
          // 網路、登入失效與限流是暫時的：保留順序，下次 online 再補送。
          // 其他 4xx 重送也不會成功（例如成員不能更新專案），丟棄這筆，否則後面的資料永遠傳不上去。
          const status = error?.status;
          const permanent = Number.isInteger(status) && status >= 400 && status < 500 && ![401, 408, 429].includes(status);
          if (!permanent) break;
          console.warn('CueMesh：略過無法同步的項目', queue[0].type, status);
        }
        queue.shift();
        await persist();
      }
    })();
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  };
  const enqueue = async (item) => {
    if (item.type === 'events') {
      const previous = queue.at(-1);
      if (previous?.type === 'events' && previous.runId === item.runId && previous.events.length + item.events.length <= MAX_EVENT_BATCH) {
        previous.events.push(...item.events);
      } else {
        queue.push(item);
      }
    } else {
      queue.push(item);
    }
    await persist();
    await flush();
  };
  const projectFor = async (projectId) => (await store.listProjects()).find((project) => project.id === projectId);
  const syncEvent = async (event) => {
    const run = await engine.getRun(event.runId);
    if (!run) return;
    // 每個專案每次啟動同步一次就夠，不必每個事件都送
    if (!syncedProjects.has(run.projectId)) {
      syncedProjects.add(run.projectId);
      const project = await projectFor(run.projectId);
      if (project) await enqueue({ type: 'project', project: safeCloudData(project) });
    }
    const deviceId = cloud.getDevice?.()?.id;
    await enqueue({ type: 'run', run: remoteRun(run, deviceId) });
    await enqueue({ type: 'events', runId: run.id, events: [safeCloudData(event)] });

    if (event.type === 'artifact') {
      const artifact = run.artifacts?.find((item) => item.id === event.payload?.artifactId);
      const clean = artifact && safeCloudData(artifact);
      if (clean && byteSize(clean) <= MAX_ARTIFACT_BYTES) {
        await enqueue({ type: 'artifact', runId: run.id, artifact: clean });
      }
    }
  };
  const start = () => {
    if (startTask) return startTask;
    startTask = (async () => {
      started = true;
      // 先訂閱再讀取持久化佇列，避免啟動短暫空窗漏掉本機引擎事件。
      const pendingEvents = [];
      let loadingQueue = true;
      offEngine = engine.subscribe((event) => {
        if (loadingQueue) {
          pendingEvents.push(event);
          return;
        }
        void syncEvent(event).catch(() => {});
      });
      offCloud = cloud.subscribe?.((event) => {
        if (event.type === 'status' && event.status === 'online') void flush();
      });
      const saved = await storage.get(queueKey);
      if (Array.isArray(saved)) queue = saved;
      loadingQueue = false;
      for (const event of pendingEvents) await syncEvent(event);
      await flush();
    })();
    return startTask;
  };
  const stop = () => {
    offEngine?.();
    offCloud?.();
    offEngine = null;
    offCloud = null;
    started = false;
    startTask = null;
  };

  const api = {
    start,
    stop,
    flush,
    getQueue: () => clone(queue),
    ready: null,
  };
  api.ready = start();
  return api;
}
