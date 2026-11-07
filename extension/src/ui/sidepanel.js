// 側邊面板入口：組裝真實的 store、供應商、瀏覽器與引擎，再交給 mountApp。
import './sidepanel.css';
import { createBrowserController } from '../browser/index.js';
import { AGENT_TYPES, MODELS, ROUTES } from '../core/catalog.js';
import { createEngine } from '../core/engine.js';
import { chromeKv, createStore } from '../core/store.js';
import { createProviders } from '../providers/index.js';
import { mountApp } from './app.js';
import { createApprovalPolicy, createApprovalQueue, createConsentQueue } from './logic.js';

const PREVIEW_PAGE = 'preview-sandbox.html';
const DEFAULT_SERVER = 'https://cuemesh.looptw.com';
const PENDING_SELECTION_KEY = 'cuemesh.pendingSelection'; // 與 background.js 相同

const root = document.getElementById('app');

// 雲端模組是可選的：載入或初始化失敗時只是沒有協作功能，單機任務照常。
// 用動態 import 包在 try 裡，src/cloud/ 還沒有時也能打包（esbuild 對此只給警告）。
async function loadCloud(store) {
  try {
    // 每個 import 都要直接 await：esbuild 只有這種寫法才允許檔案不存在，放進 Promise.all 會打包失敗
    const { createCloud } = await import('../cloud/index.js');
    const { createMesh } = await import('../cloud/mesh.js');
    const cloud = await createCloud({ kv: chromeKv(), store, defaultBaseUrl: DEFAULT_SERVER });
    return { cloud, mesh: createMesh({ cloud, store }), error: null };
  } catch (err) {
    console.warn('CueMesh：雲端模組無法載入，改為單機模式', err);
    return { cloud: null, mesh: null, error: err.message };
  }
}

// 同步與接收派工各自獨立：其中一個失敗不影響另一個，也不影響本機任務
async function startCloudServices({ cloud, engine, store, requestConsent, onForcedApproval }) {
  const problems = [];
  try {
    const { createSync } = await import('../cloud/sync.js');
    const sync = createSync({ cloud, engine, store });
    await sync?.start?.();
  } catch (err) {
    console.warn('CueMesh：同步無法啟動', err);
    problems.push(`同步：${err.message}`);
  }
  try {
    const { createRemoteRunner } = await import('../cloud/remote.js');
    const runner = createRemoteRunner({ cloud, engine, store, requestConsent, onForcedApproval });
    await runner?.start?.();
  } catch (err) {
    console.warn('CueMesh：接收派工無法啟動', err);
    problems.push(`接收派工：${err.message}`);
  }
  return problems;
}

async function main() {
  const store = await createStore();
  const approvals = createApprovalQueue();
  const consents = createConsentQueue();

  // getApprovalMode 是同步介面，所以把設定快取起來，並在設定變更時更新。
  // 讀到設定前一律用最嚴格的模式，寧可多問也不要漏問。
  // 其他帳號的派工由 onForcedApproval 標記，該任務一律逐步批准，不受使用者的 risky 設定影響。
  const policy = createApprovalPolicy('always');
  policy.setMode((await store.getSettings()).approvalMode);

  const browser = createBrowserController({
    requestApproval: approvals.request,
    getApprovalMode: policy.getApprovalMode,
  });
  const { cloud, mesh, error: cloudLoadError } = await loadCloud(store);
  const engine = createEngine({ store, providers: createProviders(), browser, mesh });
  engine.subscribe((event) => {
    if (event.type === 'run_finished') policy.release(event.runId);
  });

  // 沒有宣告沙盒頁面時退回 srcdoc：畫面還看得到，但指令碼會被擴充功能的安全政策擋下
  const hasSandbox = chrome.runtime.getManifest().sandbox?.pages?.includes(PREVIEW_PAGE);
  if (!hasSandbox) console.warn(`CueMesh：manifest 沒有宣告 ${PREVIEW_PAGE}，HTML 成果的指令碼不會執行`);

  const app = mountApp(root, {
    engine,
    store,
    browser,
    approvals,
    consents,
    cloud,
    cloudLoadError,
    catalog: { AGENT_TYPES, MODELS, ROUTES },
    previewUrl: hasSandbox ? chrome.runtime.getURL(PREVIEW_PAGE) : null,
    onSettingsChange: (next) => policy.setMode(next.approvalMode),
  });

  if (cloud) {
    // 不等待：這些服務可能在等網路，不能卡住面板與單機功能
    startCloudServices({ cloud, engine, store, requestConsent: consents.request, onForcedApproval: policy.force })
      .then((problems) => {
        if (problems.length) app.notify(`部分協作功能無法啟動，本機任務不受影響。${problems.join('；')}`);
      })
      .catch((err) => console.warn('CueMesh：協作服務啟動失敗', err));
  }

  // 右鍵選單「用 CueMesh 處理選取的文字」：background.js 暫存在 session 儲存區，面板接手後清除
  async function consumePendingSelection() {
    const session = chrome.storage.session;
    const saved = await session.get(PENDING_SELECTION_KEY);
    const item = saved[PENDING_SELECTION_KEY];
    if (!item) return;
    await session.remove(PENDING_SELECTION_KEY);
    app.addContextItem(item);
  }
  const reportSelectionError = (err) => {
    console.error('CueMesh：讀取右鍵選取內容失敗', err);
    app.notify(`讀取右鍵選取的文字失敗：${err.message}`);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[PENDING_SELECTION_KEY]?.newValue) consumePendingSelection().catch(reportSelectionError);
  });
  await app.ready();
  await consumePendingSelection().catch(reportSelectionError);
}

main().catch((err) => {
  // 組裝失敗時畫面不能一片空白，要讓使用者知道發生什麼事
  console.error('CueMesh 啟動失敗', err);
  const message = document.createElement('p');
  message.style.padding = '16px';
  message.textContent = `CueMesh 無法啟動：${err.message}。請到 chrome://extensions 重新載入擴充功能。`;
  root.replaceChildren(message);
});
