// 雲端帳號、裝置、SSE、共享、保險箱與派工 API。只依賴瀏覽器標準 Web API。
import { VAULT_PROVIDERS, VaultError, decryptKeyBundle, encryptKeyBundle, validateKeyBundle } from './vault.js';

export const CLOUD_CONFIG_KEY = 'cuemesh.cloud.config.v1';
export const CLOUD_SESSION_KEY = 'cuemesh.cloud.session.v1';
export const CLOUD_SYNC_QUEUE_KEY = 'cuemesh.cloud.syncQueue.v1';

const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_RETRY_MAX_MS = 30000;

export class CloudError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new CloudError('請先設定雲端服務網址');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CloudError('雲端服務網址格式不正確');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new CloudError('雲端服務網址格式不正確');
  }
  return url.href.replace(/\/+$/, '').replace(/\/api$/, '');
}

function deviceName(platform) {
  const name = globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform ?? '瀏覽器';
  return 'CueMesh ' + (platform ?? name);
}

function newId() {
  if (!globalThis.crypto?.randomUUID) throw new CloudError('目前瀏覽器無法產生安全的裝置識別碼');
  return globalThis.crypto.randomUUID();
}

function cloudMessage(status) {
  if (status === 400) return '雲端服務拒絕此請求';
  if (status === 401) return '登入已失效，請重新登入';
  if (status === 403) return '你沒有執行這個動作的權限';
  if (status === 404) return '找不到所需的雲端資料';
  if (status === 409) return '雲端資料已變更，請重新整理後再試';
  if (status === 413) return '要上傳的資料太大';
  if (status === 429) return '操作太頻繁，請稍後再試';
  if (typeof status === 'number' && status >= 500) return '雲端服務暫時無法使用';
  return '無法連線到雲端服務';
}

function abortError() {
  try {
    return new DOMException('操作已取消', 'AbortError');
  } catch {
    const error = new Error('操作已取消');
    error.name = 'AbortError';
    return error;
  }
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function eventFromPayload(payload, id) {
  if (!payload || typeof payload !== 'object') return null;
  const numeric = Number(payload.seq ?? id);
  return {
    ...payload,
    ...(Number.isFinite(numeric) ? { seq: numeric } : {}),
  };
}

function createSseParser() {
  let buffer = '';
  let eventId = '';
  let data = [];

  const finishEvent = (events) => {
    if (!data.length) {
      eventId = '';
      return;
    }
    const joined = data.join('\n');
    data = [];
    try {
      const parsed = JSON.parse(joined);
      const event = eventFromPayload(parsed, eventId);
      if (event) events.push(event);
    } catch {
      // 保活或損毀資料不能讓 SSE 迴圈崩潰；下一次 GET 補送會重試。
    }
    eventId = '';
  };

  return {
    feed(text) {
      buffer += text;
      const events = [];
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line) {
          finishEvent(events);
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'id') eventId = value;
        if (field === 'data') data.push(value);
      }
      return events;
    },
    finish() {
      const events = [];
      if (buffer) {
        let line = buffer;
        buffer = '';
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        if (line.startsWith('id:')) eventId = line.slice(3).replace(/^ /, '');
      }
      finishEvent(events);
      return events;
    },
  };
}

export async function createCloud({
  kv,
  fetchImpl = globalThis.fetch,
  baseUrl,
  defaultBaseUrl = '',
  store = null,
  exportKeys = null,
  platform,
  name,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  sleep = defaultSleep,
} = {}) {
  if (!kv?.get || !kv?.set) throw new Error('createCloud 需要可用的 kv 儲存');
  if (typeof fetchImpl !== 'function') throw new Error('createCloud 需要可用的 fetch');

  const config = (await kv.get(CLOUD_CONFIG_KEY)) ?? {};
  let currentBaseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : (config.baseUrl ? normalizeBaseUrl(config.baseUrl) : (defaultBaseUrl ? normalizeBaseUrl(defaultBaseUrl) : ''));
  const saved = (await kv.get(CLOUD_SESSION_KEY)) ?? {};
  let session = {
    token: typeof saved.token === 'string' ? saved.token : null,
    user: saved.user ?? null,
    deviceId: typeof saved.deviceId === 'string' ? saved.deviceId : null,
    device: saved.device ?? null,
    lastSeq: Number.isFinite(Number(saved.lastSeq)) ? Number(saved.lastSeq) : 0,
    vault: saved.vault ?? null,
  };
  let status = session.token ? 'offline' : 'signed_out';
  let streamWanted = false;
  let streamTask = null;
  let streamController = null;
  let retryController = null;
  const listeners = new Set();

  const persistConfig = async () => {
    await kv.set(CLOUD_CONFIG_KEY, { baseUrl: currentBaseUrl });
  };
  const persistSession = async () => {
    await kv.set(CLOUD_SESSION_KEY, {
      token: session.token,
      user: session.user,
      deviceId: session.deviceId,
      device: session.device,
      lastSeq: session.lastSeq,
      vault: session.vault,
    });
  };
  const emit = (event) => {
    for (const listener of listeners) {
      try {
        listener(clone(event));
      } catch {
        // 訂閱者的錯誤不可中斷網路連線或其他訂閱者。
      }
    }
  };
  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    emit({ type: 'status', status });
  };
  const apiUrl = (path, query) => {
    if (!currentBaseUrl) throw new CloudError('請先設定雲端服務網址');
    const url = new URL(currentBaseUrl + '/api' + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.href;
  };
  const request = async (path, { method = 'GET', body, auth = true, signal, query } = {}) => {
    const headers = { accept: 'application/json' };
    if (auth) {
      if (!session.token) throw new CloudError('請先登入雲端帳號', { status: 401, code: 'signed_out' });
      headers.authorization = 'Bearer ' + session.token;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response;
    try {
      response = await fetchImpl(apiUrl(path, query), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new CloudError('無法連線到雲端服務', { code: 'network' });
    }

    let payload = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      throw new CloudError(cloudMessage(response.status), {
        status: response.status,
        code: payload?.error?.code,
      });
    }
    return payload;
  };

  const clearSession = async () => {
    streamWanted = false;
    streamController?.abort();
    retryController?.abort();
    session = { token: null, user: null, deviceId: null, device: null, lastSeq: 0, vault: null };
    await kv.set(CLOUD_SESSION_KEY, null);
    await kv.set(CLOUD_SYNC_QUEUE_KEY, []);
    setStatus('signed_out');
  };
  const ensureDevice = async () => {
    if (!session.token) throw new CloudError('請先登入雲端帳號', { status: 401, code: 'signed_out' });
    const id = session.deviceId ?? newId();
    const result = await request('/devices/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { name: session.device?.name ?? name ?? deviceName(platform), platform: platform ?? 'chrome-extension' },
    });
    session.deviceId = result?.device?.id ?? id;
    session.device = result?.device ?? { id: session.deviceId, name: name ?? deviceName(platform), platform: platform ?? 'chrome-extension' };
    await persistSession();
    return clone(session.device);
  };
  const handleSseEvent = async (event) => {
    if (Number.isFinite(event.seq)) {
      if (event.seq <= session.lastSeq) return false;
      session.lastSeq = event.seq;
      await persistSession();
    }
    if (event.type === 'vault_update') {
      const vault = event.payload?.vault;
      session.vault = vault ? { exists: true, updatedAt: vault.updatedAt ?? null, version: vault.version } : session.vault;
      await persistSession();
    }
    emit(event);
    return true;
  };
  const consumeStream = async (body, signal) => {
    if (!body?.getReader) throw new CloudError('雲端即時連線格式不正確');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    let eventCount = 0;
    try {
      while (!signal.aborted) {
        const item = await reader.read();
        if (item.done) break;
        for (const event of parser.feed(decoder.decode(item.value, { stream: true }))) {
          if (await handleSseEvent(event)) eventCount += 1;
        }
      }
      for (const event of parser.feed(decoder.decode())) {
        if (await handleSseEvent(event)) eventCount += 1;
      }
      for (const event of parser.finish()) {
        if (await handleSseEvent(event)) eventCount += 1;
      }
    } finally {
      reader.releaseLock?.();
    }
    return eventCount;
  };
  const streamLoop = async () => {
    let retries = 0;
    while (streamWanted && session.token && session.deviceId) {
      try {
        setStatus('connecting');
        const controller = new AbortController();
        streamController = controller;
        let response;
        try {
          response = await fetchImpl(apiUrl('/stream', { deviceId: session.deviceId, since: session.lastSeq }), {
            method: 'GET',
            headers: { accept: 'text/event-stream', authorization: 'Bearer ' + session.token },
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) break;
          throw error;
        }
        if (!response.ok) {
          if (response.status === 401) {
            await clearSession();
            break;
          }
          throw new CloudError(cloudMessage(response.status), { status: response.status });
        }
        setStatus('online');
        // 只有成功收到事件才重設退避。伺服器立即關線時仍會真正指數退避。
        if (await consumeStream(response.body, controller.signal)) retries = 0;
        if (!streamWanted || controller.signal.aborted) break;
      } catch (error) {
        if (!streamWanted || error?.name === 'AbortError') break;
      } finally {
        streamController = null;
      }
      if (!streamWanted || !session.token) break;
      setStatus('offline');
      const delay = Math.min(retryBaseMs * (2 ** retries), retryMaxMs);
      retries += 1;
      const controller = new AbortController();
      retryController = controller;
      try {
        await sleep(delay, controller.signal);
      } catch {
        break;
      } finally {
        if (retryController === controller) retryController = null;
      }
    }
    if (!session.token) setStatus('signed_out');
    else if (!streamWanted) setStatus('offline');
  };
  const connect = () => {
    if (!session.token) {
      setStatus('signed_out');
      return Promise.resolve();
    }
    streamWanted = true;
    if (!streamTask) {
      streamTask = streamLoop().finally(() => {
        streamTask = null;
      });
    }
    return Promise.resolve();
  };
  const disconnect = async () => {
    streamWanted = false;
    streamController?.abort();
    retryController?.abort();
    const task = streamTask;
    if (task) await task.catch(() => {});
    if (session.token) setStatus('offline');
  };
  const completeAuthentication = async (payload) => {
    if (typeof payload?.token !== 'string' || !payload.token || !payload.user) {
      throw new CloudError('雲端登入回應格式不正確');
    }
    session.token = payload.token;
    session.user = payload.user;
    session.lastSeq = 0;
    await persistSession();
    await ensureDevice();
    await connect();
    return clone(session.user);
  };
  const exportLocalKeys = async () => {
    let raw;
    if (typeof exportKeys === 'function') raw = await exportKeys();
    else if (typeof store?.exportKeys === 'function') raw = await store.exportKeys();
    else {
      throw new VaultError('目前的本機儲存模組無法匯出 API key，無法建立保險箱');
    }
    return validateKeyBundle(Object.fromEntries(VAULT_PROVIDERS.map((provider) => [provider, raw?.[provider] ?? null])));
  };
  const unwrapDispatch = (result) => result?.dispatch ?? result;

  const cloud = {
    async register({ email, password, displayName }) {
      return completeAuthentication(await request('/auth/register', { method: 'POST', auth: false, body: { email, password, displayName } }));
    },
    async login({ email, password }) {
      return completeAuthentication(await request('/auth/login', { method: 'POST', auth: false, body: { email, password } }));
    },
    async logout() {
      try {
        if (session.token) await request('/auth/logout', { method: 'POST' });
      } catch {
        // 即使伺服器離線也必須在本機登出，不能留下其他帳號的 token。
      } finally {
        await disconnect();
        await clearSession();
      }
    },
    getUser: () => clone(session.user),
    getDevice: () => clone(session.device),
    getBaseUrl: () => currentBaseUrl,
    getStatus: () => status,
    async setBaseUrl(url) {
      const next = normalizeBaseUrl(url);
      const reconnect = Boolean(session.token);
      await disconnect();
      currentBaseUrl = next;
      await persistConfig();
      if (reconnect) await connect();
      return currentBaseUrl;
    },
    async renameDevice(nextName) {
      if (typeof nextName !== 'string' || !nextName.trim()) throw new CloudError('裝置名稱不可空白');
      if (!session.deviceId) await ensureDevice();
      const result = await request('/devices/' + encodeURIComponent(session.deviceId), { method: 'PATCH', body: { name: nextName.trim() } });
      session.device = result.device;
      await persistSession();
      return clone(session.device);
    },
    async setAcceptRemote(acceptRemote) {
      if (!['off', 'ask', 'auto'].includes(acceptRemote)) throw new CloudError('遠端派工設定不正確');
      if (!session.deviceId) await ensureDevice();
      const result = await request('/devices/' + encodeURIComponent(session.deviceId), { method: 'PATCH', body: { acceptRemote } });
      session.device = result.device;
      await persistSession();
      return clone(session.device);
    },
    async listDevices() {
      return (await request('/devices')).devices ?? [];
    },
    async listProjects() {
      return (await request('/projects')).projects ?? [];
    },
    async createInvite(projectId) {
      return request('/projects/' + encodeURIComponent(projectId) + '/invites', { method: 'POST', body: {} });
    },
    async acceptInvite(code) {
      return (await request('/invites/accept', { method: 'POST', body: { code } })).project;
    },
    async listMembers(projectId) {
      return (await request('/projects/' + encodeURIComponent(projectId) + '/members')).members ?? [];
    },
    async removeMember(projectId, userId) {
      await request('/projects/' + encodeURIComponent(projectId) + '/members/' + encodeURIComponent(userId), { method: 'DELETE' });
    },
    async vaultStatus() {
      const result = await request('/vault');
      const vault = result?.vault ?? null;
      session.vault = vault ? { exists: true, updatedAt: vault.updatedAt ?? null, version: vault.version } : { exists: false, updatedAt: null, version: 0 };
      await persistSession();
      return clone(session.vault);
    },
    async vaultPush(passphrase) {
      const keys = await exportLocalKeys();
      const current = await request('/vault');
      const expectedVersion = current?.vault?.version ?? 0;
      const encrypted = await encryptKeyBundle(keys, passphrase);
      const result = await request('/vault', { method: 'PUT', body: { expectedVersion, ...encrypted } });
      const vault = result.vault;
      session.vault = { exists: true, updatedAt: vault.updatedAt ?? null, version: vault.version };
      await persistSession();
      return clone(session.vault);
    },
    async vaultPull(passphrase) {
      if (!store?.setKey) throw new VaultError('目前的本機儲存模組無法匯入 API key');
      const result = await request('/vault');
      if (!result?.vault) throw new VaultError('雲端沒有可還原的保險箱備份');
      // 先完整解密與驗證；任何錯誤都不會觸碰本機 key。
      const keys = await decryptKeyBundle(result.vault, passphrase);
      if (VAULT_PROVIDERS.some((provider) => keys[provider] === null) && typeof store.removeKey !== 'function') {
        throw new VaultError('目前的本機儲存模組無法移除 API key');
      }
      for (const provider of VAULT_PROVIDERS) {
        if (keys[provider] === null) await store.removeKey(provider);
        else await store.setKey(provider, keys[provider]);
      }
      session.vault = { exists: true, updatedAt: result.vault.updatedAt ?? null, version: result.vault.version };
      await persistSession();
      return await store.getKeyStatus?.();
    },
    async deleteVault() {
      await request('/vault', { method: 'DELETE' });
      session.vault = { exists: false, updatedAt: null, version: 0 };
      await persistSession();
    },
    async listDispatches({ role, status } = {}) {
      return (await request('/dispatches', { query: { role, status } })).dispatches ?? [];
    },
    async getDispatch(id) {
      return request('/dispatches/' + encodeURIComponent(id));
    },
    async dispatch({ id = newId(), targetDeviceId, projectId, goal, context, options, parent }) {
      const result = await request('/dispatches', {
        method: 'POST',
        // senderDeviceId 決定提問由哪台裝置的主 agent 回答
        body: { id, targetDeviceId, senderDeviceId: session.deviceId, projectId, goal, context, options, parent },
      });
      return unwrapDispatch(result);
    },
    async acceptDispatch(id, runId) {
      const value = typeof runId === 'object' ? runId?.runId : runId;
      return unwrapDispatch(await request('/dispatches/' + encodeURIComponent(id) + '/accept', { method: 'POST', body: { runId: value } }));
    },
    async rejectDispatch(id, reason) {
      return unwrapDispatch(await request('/dispatches/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: { reason } }));
    },
    async reportDispatch(id, report) {
      return unwrapDispatch(await request('/dispatches/' + encodeURIComponent(id) + '/report', { method: 'POST', body: report }));
    },
    async cancelDispatch(id) {
      return unwrapDispatch(await request('/dispatches/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }));
    },
    async sendDispatchMessage(id, { id: messageId = newId(), kind, text, replyTo }) {
      return (await request('/dispatches/' + encodeURIComponent(id) + '/messages', {
        method: 'POST',
        body: { id: messageId, kind, text, replyTo },
      })).message;
    },
    // 同步模組使用的低階 API；資料清理由 sync.js 負責。
    async putProject(project) {
      return (await request('/projects/' + encodeURIComponent(project.id), { method: 'PUT', body: { name: project.name, description: project.description ?? '' } })).project;
    },
    async putRun(run) {
      return (await request('/runs/' + encodeURIComponent(run.id), { method: 'PUT', body: run })).run;
    },
    async postRunEvents(runId, events) {
      return (await request('/runs/' + encodeURIComponent(runId) + '/events', { method: 'POST', body: { events } })).accepted;
    },
    async putArtifact(runId, artifact) {
      return (await request('/runs/' + encodeURIComponent(runId) + '/artifacts/' + encodeURIComponent(artifact.id), { method: 'PUT', body: artifact })).artifact;
    },
    connect,
    disconnect,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // 供 sync.js 使用，避免它讀取或清除 core store 的資料。
    storage: kv,
  };

  if (currentBaseUrl && baseUrl) await persistConfig();
  if (session.token) {
    if (!session.deviceId) {
      ensureDevice().then(connect).catch(() => setStatus('offline'));
    } else {
      void connect();
    }
  }
  return cloud;
}
