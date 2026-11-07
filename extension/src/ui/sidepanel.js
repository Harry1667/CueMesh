// 側邊面板入口：組裝真實的 store、供應商、瀏覽器與引擎，再交給 mountApp。
import './sidepanel.css';
import { createBrowserController } from '../browser/index.js';
import { AGENT_TYPES, MODELS, ROUTES } from '../core/catalog.js';
import { createEngine } from '../core/engine.js';
import { createStore } from '../core/store.js';
import { createProviders } from '../providers/index.js';
import { mountApp } from './app.js';
import { createApprovalQueue } from './logic.js';

const PREVIEW_PAGE = 'preview-sandbox.html';
const PENDING_SELECTION_KEY = 'cuemesh.pendingSelection'; // 與 background.js 相同

const root = document.getElementById('app');

async function main() {
  const store = await createStore();
  const approvals = createApprovalQueue();

  // getApprovalMode 是同步介面，所以把設定快取起來，並在設定變更時更新。
  // 讀到設定前一律用最嚴格的模式，寧可多問也不要漏問。
  let approvalMode = 'always';
  const settings = await store.getSettings();
  approvalMode = settings.approvalMode ?? 'always';

  const browser = createBrowserController({
    requestApproval: approvals.request,
    getApprovalMode: () => approvalMode,
  });
  const engine = createEngine({ store, providers: createProviders(), browser });

  // 沒有宣告沙盒頁面時退回 srcdoc：畫面還看得到，但指令碼會被擴充功能的安全政策擋下
  const hasSandbox = chrome.runtime.getManifest().sandbox?.pages?.includes(PREVIEW_PAGE);
  if (!hasSandbox) console.warn(`CueMesh：manifest 沒有宣告 ${PREVIEW_PAGE}，HTML 成果的指令碼不會執行`);

  const app = mountApp(root, {
    engine,
    store,
    browser,
    approvals,
    catalog: { AGENT_TYPES, MODELS, ROUTES },
    previewUrl: hasSandbox ? chrome.runtime.getURL(PREVIEW_PAGE) : null,
    onSettingsChange: (next) => {
      approvalMode = next.approvalMode ?? 'always';
    },
  });

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
