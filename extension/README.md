# CueMesh 擴充功能

## 安裝與建置

```bash
cd extension
npm install
npm run build
```

載入 Chrome：

1. 開啟 `chrome://extensions`
2. 打開右上角「開發人員模式」
3. 按「載入未封裝項目」，選 `extension/dist`
4. 點工具列的 CueMesh 圖示開啟側邊面板
5. 到設定頁填入至少一家 AI 服務的 API key

## 開發

```bash
npm test        # 跑所有單元測試，不會呼叫真實 AI API
npm run watch   # 修改 src/ 後自動重新打包，再到 chrome://extensions 按重新載入
```

架構與模組介面見 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 使用時要知道的事

- **側邊面板要保持開啟：** agent 在面板裡執行，關掉面板任務就會中斷。
- **API key 只存在這台電腦：** 存在 `chrome.storage.local`，沒有加密，不會傳給網站，也不要在共用電腦上使用。
- **費用是估計值：** 依公開牌價計算，實際金額以各家帳單為準；預算上限超過時會在下一次檢查時停止。
- **批准模式：** 預設每個會改變頁面的動作都要批准。密碼與付款欄位一律拒絕代填。
- **提示注入無法百分之百防止：** 網頁內容都標記為不可信資料，但模型仍可能被誤導，所以重要動作請確實看過再批准。
