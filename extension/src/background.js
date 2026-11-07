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
