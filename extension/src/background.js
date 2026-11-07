// Service worker：只負責開啟側邊面板與右鍵選單。agent 迴圈都在側邊面板裡執行，
// 因為 MV3 的 service worker 閒置時會被休眠，不適合跑長時間任務。

const MENU_ASK = 'cuemesh-ask-selection';
const PENDING_SELECTION_KEY = 'cuemesh.pendingSelection';

async function logFailure(label, promise) {
  try {
    return await promise;
  } catch (err) {
    console.error(`CueMesh：${label}失敗`, err);
    return undefined;
  }
}

// ---- 工具列圖示跟著深淺色切換：深色用白色 Logo，淺色用黑色 Logo ----
const THEME_DOCUMENT = 'theme-icon.html';
const iconPaths = (prefix) => Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${prefix}-${size}.png`]));

async function ensureThemeDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: THEME_DOCUMENT,
    reasons: ['MATCH_MEDIA'],
    justification: '偵測深淺色模式，切換工具列圖示',
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'cuemesh:color-scheme') return;
  void logFailure('切換工具列圖示', chrome.action.setIcon({ path: iconPaths(message.dark ? 'icon-light' : 'icon') }));
});

// service worker 每次啟動都會跑到這裡，瀏覽器重開後也一樣，不需要另外監聽 onStartup
void logFailure('偵測深淺色', ensureThemeDocument());

chrome.runtime.onInstalled.addListener(() => {
  void logFailure('設定側邊面板', chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
  chrome.contextMenus.create({ id: MENU_ASK, title: '用 CueMesh 處理選取的文字', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ASK || !tab?.id) return;
  // 開啟面板必須在使用者手勢的同步流程內呼叫，所以不能先 await
  void logFailure('開啟側邊面板', chrome.sidePanel.open({ tabId: tab.id }));
  void logFailure('暫存選取內容', chrome.storage.session.set({
    [PENDING_SELECTION_KEY]: { type: 'selection', tabId: tab.id, url: tab.url, title: tab.title, text: info.selectionText ?? '' },
  }));
});
