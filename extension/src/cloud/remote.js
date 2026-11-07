// 接收其他裝置派工；伺服器回傳的 crossAccount 是唯一帳號邊界依據。
import { remoteRun } from './sync.js';

const TERMINAL = new Set(['done', 'partial', 'failed', 'cancelled', 'rejected', 'expired']);
const SENSITIVE_PARAM = /^(api_?keys?|authorization|passwords?|secrets?|access_?tokens?|refresh_?tokens?|tokens?|key)$/i;
const SENSITIVE_TEXT = /\b(?:api[ _-]?key|authorization|password|secret|access[ _-]?token|refresh[ _-]?token)\b\s*(?:[:=]|是)\s*[^\s,;，；]+/gi;
const TOKEN_LIKE_VALUE = /\b(?:sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{32,})\b/g;

function dispatchFrom(value) {
  return value?.dispatch ?? value;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sourcesFrom(run) {
  const sources = new Map();
  for (const task of run?.tasks ?? []) {
    for (const source of task.sources ?? []) {
      const url = cleanUrl(source?.url);
      if (url && !sources.has(url)) sources.set(url, { title: cleanText(source.title || url), url });
    }
  }
  return [...sources.values()];
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value);
  if (/^data:image\//i.test(text)) return '[已略過影像資料]';
  return text.replace(SENSITIVE_TEXT, '[已移除敏感資料]').replace(TOKEN_LIKE_VALUE, '[已移除敏感資料]');
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function reportFor(run, runId) {
  const status = ['done', 'partial', 'failed', 'cancelled'].includes(run?.status) ? run.status : 'failed';
  const result = cleanText(run?.finalResult);
  return {
    status,
    runId,
    summary: result ? String(result).slice(0, 2000) : null,
    result,
    sources: sourcesFrom(run),
    error: cleanText(run?.error),
    costUsd: Number(run?.costUsd ?? 0),
  };
}

// 只留文字情境。對方傳來的 tabId 不可採用，否則能讓 agent 去操作這台裝置開著的其他分頁（例如網銀）；
// 圖片與其他欄位也一律捨棄。
export function safeDispatchContext(context) {
  if (!Array.isArray(context)) return [];
  const asText = (value) => (typeof value === 'string' ? value : undefined);
  return context
    .filter((item) => item && typeof item === 'object' && typeof item.text === 'string' && item.text)
    .map((item) => ({ type: asText(item.type) ?? 'context', text: item.text, url: asText(item.url), title: asText(item.title) }));
}

function waitForRun(engine, runId) {
  if (typeof engine.waitForRun === 'function') return engine.waitForRun(runId);
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const run = await engine.getRun(runId);
      if (run?.finishedAt || ['done', 'partial', 'failed', 'cancelled'].includes(run?.status)) {
        clearInterval(timer);
        resolve(run);
      }
    }, 500);
  });
}

export function createRemoteRunner({
  cloud,
  engine,
  store,
  requestConsent = async () => ({ accepted: false, reason: '需要使用者確認才能接受遠端派工' }),
  onForcedApproval = async () => {},
} = {}) {
  if (!cloud || !engine || !store) throw new Error('createRemoteRunner 需要 cloud、engine 與 store');
  const handled = new Set();
  const processing = new Set();
  const executions = new Map();

  const freshDispatch = async (candidate) => {
    if (!candidate?.id) return null;
    if (typeof cloud.getDispatch !== 'function') return candidate;
    const result = await cloud.getDispatch(candidate.id);
    return dispatchFrom(result);
  };
  const reject = async (dispatch, reason) => {
    await cloud.rejectDispatch?.(dispatch.id, reason);
    return { accepted: false, reason };
  };
  const localProject = async (dispatch) => {
    const projects = await store.listProjects();
    const found = projects.find((project) => project.id === dispatch.projectId);
    if (found) return found.id;
    // 必須沿用雲端專案 id：伺服器只接受同一專案內的任務回報
    let name = '';
    try {
      const shared = await cloud.listProjects?.();
      name = shared?.find?.((project) => project.id === dispatch.projectId)?.name ?? '';
    } catch {
      // 取不到專案名稱不影響執行，改用預設名稱。
    }
    const project = await store.ensureProject({
      id: dispatch.projectId,
      name: name || '遠端派工：' + (dispatch.senderName || '其他裝置'),
    });
    return project.id;
  };
  const budgetFor = async (dispatch) => {
    const settings = await store.getSettings();
    const local = numberOr(settings?.maxCostUsd, 2);
    const requested = numberOr(dispatch.options?.maxCostUsd, local);
    return Math.min(local, requested);
  };
  const observe = async (dispatchId, runId) => {
    try {
      await waitForRun(engine, runId);
      const run = await engine.getRun(runId);
      // 伺服器不接受 cancelled 回報；這台自己取消時改走取消流程
      if (run?.status === 'cancelled') {
        await cloud.cancelDispatch?.(dispatchId);
        return;
      }
      // 回報前先確定任務已上傳，背景同步可能還沒送到，否則伺服器會拒絕回報
      await cloud.putRun?.(remoteRun(run, cloud.getDevice?.()?.id));
      await cloud.reportDispatch(dispatchId, reportFor(run, runId));
    } catch (error) {
      await cloud.reportDispatch(dispatchId, {
        status: 'failed',
        runId,
        summary: null,
        result: null,
        sources: [],
        error: '遠端派工執行或回報失敗',
        costUsd: 0,
      }).catch(() => {});
    } finally {
      executions.delete(dispatchId);
    }
  };
  const handleDispatch = async (candidate) => {
    if (!candidate?.id || handled.has(candidate.id) || processing.has(candidate.id)) return { ignored: true };
    // 在任何 await 前標記，SSE 重送或同時到達的事件都不會啟動第二次；暫時網路失敗可在重送時再試。
    processing.add(candidate.id);

    let dispatch;
    let runId = null;
    try {
      dispatch = await freshDispatch(candidate);
      if (!dispatch || dispatch.status !== 'pending') {
        handled.add(candidate.id);
        return { ignored: true };
      }

      const device = cloud.getDevice?.() ?? {};
      const acceptRemote = device.acceptRemote ?? 'ask';
      if (acceptRemote === 'off') {
        const result = await reject(dispatch, '此裝置目前不接受遠端派工');
        handled.add(dispatch.id);
        return result;
      }

      // 只能相信伺服器回傳欄位；不可由 sender、device id 或 payload 推論帳號關係。
      const crossAccount = dispatch.crossAccount === true;
      const needsConsent = crossAccount || acceptRemote !== 'auto';
      if (needsConsent) {
        const consent = await requestConsent(dispatch);
        if (!consent?.accepted) {
          const result = await reject(dispatch, consent?.reason || '使用者拒絕此遠端派工');
          handled.add(dispatch.id);
          return result;
        }
      }

      const projectId = await localProject(dispatch);
      runId = engine.start({
        projectId,
        goal: dispatch.goal,
        context: safeDispatchContext(dispatch.context),
        options: { maxCostUsd: await budgetFor(dispatch), dispatchId: dispatch.id },
      });
      executions.set(dispatch.id, { runId });
      // 跨帳號即使裝置設定為 auto，也一定強制瀏覽器逐步批准。
      // 先完成強制模式安裝，才做任何會讓引擎繼續執行的非同步工作。
      if (crossAccount) await onForcedApproval(runId);
      await cloud.acceptDispatch(dispatch.id, { runId });
      handled.add(dispatch.id);
      void observe(dispatch.id, runId);
      return { accepted: true, runId };
    } catch (error) {
      if (runId) engine.cancel?.(runId);
      if (dispatch?.status === 'pending') {
        try {
          await cloud.rejectDispatch?.(dispatch.id, '無法安全地接受此遠端派工');
        } catch {
          // 本機安全拒絕已完成；網路重連後伺服器端仍會讓派工逾期。
        }
      }
      if (runId) handled.add(candidate.id);
      return { accepted: false, reason: '無法安全地接受此遠端派工' };
    } finally {
      processing.delete(candidate.id);
    }
  };
  const onCloudEvent = (event) => {
    // 剛登入或斷線重連時，把錯過的派工補回來
    if (event.type === 'status' && event.status === 'online') {
      void reconcile();
      return;
    }
    if (event.type === 'dispatch_created') {
      void handleDispatch(dispatchFrom(event.payload));
      return;
    }
    if (event.type !== 'dispatch_update') return;
    const dispatch = dispatchFrom(event.payload);
    if (!dispatch?.id) return;
    if (dispatch.status === 'pending') {
      void handleDispatch(dispatch);
      return;
    }
    if (TERMINAL.has(dispatch.status) && executions.has(dispatch.id)) {
      engine.cancel?.(executions.get(dispatch.id).runId);
    }
  };

  const off = cloud.subscribe?.(onCloudEvent) ?? (() => {});
  // 事件剛好在面板啟動前送達時，以 incoming pending 清單補救；同一筆仍受 handled/processing 保護。
  const reconcile = async () => {
    if (typeof cloud.listDispatches !== 'function') return;
    try {
      const dispatches = await cloud.listDispatches({ role: 'incoming', status: 'pending' });
      for (const dispatch of dispatches) void handleDispatch(dispatch);
    } catch {
      // SSE 重連或下一次顯式重整會再補，不可影響本機工作。
    }
  };
  void reconcile();
  return {
    handleDispatch,
    reconcile,
    stop() {
      off();
    },
    getExecution(id) {
      return executions.get(id) ?? null;
    },
  };
}
