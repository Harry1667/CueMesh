# CueMesh 擴充功能架構與模組介面

所有工作者都以這份文件為準。要改介面，先回報給負責整合的 Claude，不要自行改動。

## 整體

Chrome MV3 擴充功能，**不依賴任何後端**。agent 迴圈跑在側邊面板頁面（面板開著就不會被休眠），API key 存 `chrome.storage.local`。

```text
側邊面板 UI (src/ui)
   │ createEngine()
核心 (src/core)：規劃 → 路由 → 平行執行 → @ 委派 → 整合
   ├─ 供應商 (src/providers)：Anthropic / OpenAI / Gemini 統一介面
   └─ 瀏覽器 (src/browser)：透過 chrome API 操作分頁，頁面內邏輯在 src/content
```

用 esbuild 打包到 `dist/`，Chrome 載入 `dist/`。語言：JavaScript ESM、async/await、註解用繁體中文。使用者看得到的文字一律繁體中文。錯誤要明確，不可 silent fail。

## 目錄與負責人（只能改自己的目錄）

| 目錄 | 負責人 |
|---|---|
| `src/core/`、`test/core/`、`build.mjs`、`public/manifest.json`、`src/background.js`、`README.md`、`ARCHITECTURE.md` | 整合者 Claude（主控視窗） |
| `src/providers/openai.js`、`src/providers/gemini.js`、`src/providers/index.js`、`test/providers/` | Codex B |
| `src/browser/`、`src/content/`、`test/browser/` | Codex A |
| `src/ui/`、`test/ui/` | Claude UI |

共同規則：

- 不要執行 `git commit`、`git push`、切換分支，由整合者統一提交。
- 不要新增相依套件；確實需要時寫在交接檔，由整合者安裝。
- 不要呼叫真實 AI API，不要讀取或要求任何 API key。測試用本機假伺服器或假物件。
- 測試用 `node:test`，從 `extension/` 目錄執行 `npm test`。
- 完成時寫交接檔 `.handoff/<負責人>.md`：做了什麼、實跑了什麼測試與結果、已知限制、需要整合者處理的事。

## 介面一：供應商（`src/providers/types.js` 已定義）

```js
provider.name // 'anthropic' | 'openai' | 'gemini'
await provider.turn({ apiKey, model, system, messages, tools, webSearch, maxTokens, effort, signal })
// → { text, toolCalls: [{ id, name, args }], usage: { input, output }, sources: [{ title, url }], raw }
```

- `tools`：`[{ name, description, parameters /* JSON Schema */ }]`，可省略。
- `webSearch`：是否使用供應商內建網路搜尋。不能和自訂工具同時用時，保留搜尋、捨棄自訂工具。
- `effort`：`'low' | 'medium' | 'high'`，供應商不支援就忽略。
- 錯誤一律丟 `ProviderError(kind, message, { provider, status })`，用 `classifyHttpError`。取消時讓 AbortError 直接往外丟。訊息不可包含 API key。
- 中立訊息格式：
  - `{ role: 'user', content: [{ type: 'text', text } | { type: 'image', mediaType, data /* base64 */ }] }`
  - `{ role: 'assistant', text, toolCalls, raw }`：`raw` 是上一次 `turn` 回傳的原始內容，**必須原樣送回**（推理項目、thought signature 都在裡面）。
  - `{ role: 'tool', results: [{ id, name, text, image?: { mediaType, data }, isError? }] }`
- 參考範本：`src/providers/anthropic.js`。SDK 都要在瀏覽器環境可用（OpenAI 需 `dangerouslyAllowBrowser: true`），並可傳 `baseURL` 給測試用假伺服器。
- `src/providers/index.js` 匯出 `createProviders({ baseURLs } = {})`，回傳 `{ anthropic, openai, gemini }`。

## 介面二：瀏覽器（`src/browser/index.js`）

```js
const browser = createBrowserController({ chromeApi = chrome, requestApproval, getApprovalMode });

await browser.execute({ runId, tabId, tool, args })
// → { ok: true, text?, image?: { mediaType, data } }
// → { ok: false, error, denied?: true }
await browser.captureContext(kind, { tabId })   // kind: 'selection' | 'region' | 'element' | 'page'
// → { type: kind, tabId, url, title, text?, image?: { mediaType, data } }，使用者取消時回 null
browser.releaseRun(runId)                        // 任務結束時清除分頁綁定
```

- `tool` 名稱與參數見 `src/core/tools.js` 的 `BROWSER_TOOLS`，全部要實作。
- 一次任務綁定發起時的分頁加上它自己開的分頁，不可操作其他分頁。沒有 `tabId` 時用目前視窗的作用中分頁。
- `browser_snapshot` 回傳網址、標題、可互動元素（`ref`、角色、名稱、狀態）與可見文字；`ref` 只在該次快照的頁面有效。過期就回明確錯誤，叫 agent 重新快照。
- 頁面內程式用 `chrome.scripting.executeScript` 注入 `content.js`（由 `src/content/index.js` 打包）。
- `chrome://`、Chrome 線上應用程式商店等受限頁面要回明確錯誤。

### 批准機制（由瀏覽器模組強制執行，模型不可繞過）

```js
await requestApproval({ runId, tool, args, risk: 'act' | 'high', reason, url, element })
// → { approved: boolean, note?: string }
getApprovalMode() // → 'always'（所有動作都問）| 'risky'（只問高風險）
```

- 唯讀工具不需批准。其他動作依模式詢問，`high` 在任何模式都要問。
- 判定為 `high`：按鈕或連結文字涉及送出、付款、購買、刪除、發布、傳送、確認（中英文）；表單提交；按 Enter；跨來源導覽；網址帶查詢參數的導覽。
- **直接拒絕，不詢問：** 在 `type=password`、信用卡相關（`autocomplete` 為 `cc-*`、名稱含 card/cvv）欄位輸入。回 `ok: false`，說明需由使用者親自輸入。
- 只允許 `http:`、`https:` 導覽。
- 判定邏輯放純函式（`src/browser/risk.js`），要有單元測試。

## 介面三：核心引擎（`src/core/engine.js`，整合者負責）

```js
const engine = createEngine({ store, providers, browser, keys });

const runId = engine.start({ projectId, goal, context, options });
// context：captureContext 回傳物件的陣列
// options：{ mode?: 'auto' | 'council', workflowId?, maxCostUsd? }
engine.cancel(runId);
const off = engine.subscribe((event) => {});   // Event 格式見 docs/integration-contract.md
await engine.getRun(runId);                    // Run，含 tasks、artifacts、events
```

## 介面四：儲存（`src/core/store.js`，整合者負責）

```js
await store.listProjects(); await store.createProject({ name, description }); await store.deleteProject(id);
await store.listRuns(projectId);
await store.getKeyStatus();                    // { anthropic: { set, last4 }, openai, gemini }
await store.setKey(provider, apiKey); await store.removeKey(provider);
await store.getSettings(); await store.updateSettings(patch);
// settings：{ approvalMode: 'always' | 'risky', maxCostUsd, teamPrefs: { [agent]: 'provider/model' } }
await store.listWorkflows(); await store.saveWorkflow({ id?, name, steps: [{ title, agent, instructions }] }); await store.deleteWorkflow(id);
await store.getStats();                        // 各模型在各工作類型的成功、失敗、耗時與費用
```

模型目錄與 agent 定義：`import { MODELS, AGENT_TYPES, ROUTES } from '../core/catalog.js'`。

## 介面五：UI（`src/ui/`）

入口 `src/ui/sidepanel.html` 與 `src/ui/sidepanel.js`，打包到 `dist/sidepanel.html`、`dist/sidepanel.js`、`dist/sidepanel.css`。`src/ui/app.js` 匯出 `mountApp(root, { engine, store, browser, providers })`，方便用假物件測試；`sidepanel.js` 組裝真實物件後呼叫它，並把 `requestApproval` 接到 UI 的批准對話框。
