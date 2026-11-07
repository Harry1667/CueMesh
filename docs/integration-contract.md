# 擴充功能與網站的對接規格（草案 v1）

> **2026-11-07 更新：帳號改由 `server/` 統一提供，網站不要另外做帳號。** API 見 [`cloud-api.md`](cloud-api.md)。
> 狀態：伺服器開發中。網站可以先用本文件的範例資料做畫面，之後再接真實資料。
> 要修改本文件，請先和另一個模組的負責人確認。

## 一、分工邊界

| 事項 | 擴充功能 | 網站 |
|---|---|---|
| 執行 agent、呼叫 AI、操作瀏覽器 | 負責 | 不負責 |
| 使用者的 AI API key | 只存在瀏覽器本機 | **不接收、不儲存** |
| 帳號、註冊、登入 | 呼叫 `server/` | 呼叫 `server/`，只做畫面 |
| 專案清單與進度畫面 | 回報資料到 `server/` | 從 `server/` 讀取並顯示 |
| 批准瀏覽器動作 | 負責 | 只顯示結果 |

資料流向：**擴充功能執行工作並回報到 `server/`，網站從 `server/` 讀取並顯示。** 網站不會直接控制瀏覽器。

## 二、資料模型

時間一律是 Unix 毫秒。ID 是字串，由擴充功能產生（UUID）。

### Project（專案）

```json
{ "id": "uuid", "name": "競品研究", "description": "", "createdAt": 1762480000000 }
```

### Run（一次任務）

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "goal": "比較這三個產品的價格",
  "status": "running",
  "mode": "auto",
  "planSummary": "先查資料，再整理成表格",
  "finalResult": null,
  "error": null,
  "costUsd": 0.0123,
  "inputTokens": 1800,
  "outputTokens": 420,
  "createdAt": 1762480000000,
  "finishedAt": null
}
```

- `status`：`planning`、`running`、`done`、`partial`（部分完成）、`failed`、`cancelled`
- `mode`：`auto`、`council`（多家 AI 獨立作答後比較）、`workflow`（使用者存好的固定流程）
- `costUsd` 是依公開牌價算出的估計值，不是帳單金額

### Task（子任務）

```json
{
  "id": "uuid",
  "runId": "uuid",
  "parentTaskId": null,
  "title": "查詢價格",
  "agent": "research",
  "status": "done",
  "provider": "gemini",
  "model": "gemini-3.8-flash",
  "result": "……",
  "sources": [{ "title": "官方價格頁", "url": "https://example.com/pricing" }],
  "error": null,
  "startedAt": 1762480000000,
  "finishedAt": 1762480060000
}
```

- `agent`：`research`、`coding`、`3d`、`vision`、`planning`、`review`、`browser`
- `status`：`pending`、`running`、`done`、`failed`
- `parentTaskId` 有值時，代表這個任務是其他 agent 用 `@` 委派出來的
- `provider`：`anthropic`、`openai`、`gemini`

### Artifact（成果檔案）

```json
{ "id": "uuid", "runId": "uuid", "name": "index.html", "kind": "html", "content": "……", "createdBy": "3d", "createdAt": 1762480000000 }
```

`kind`：`html`、`code`、`markdown`、`data`。

**資安注意：** 網站顯示 `html` 成果時必須放進 `sandbox` iframe，並使用獨立的內容安全政策，因為內容由 AI 產生，不可信。

### Event（進度事件）

```json
{ "seq": 12, "runId": "uuid", "type": "task_update", "payload": {}, "createdAt": 1762480000000 }
```

`seq` 在同一個 Run 內遞增，網站要用 `runId + seq` 去重，因為網路重試時可能收到重複事件。

| `type` | `payload` | 網站可以顯示成 |
|---|---|---|
| `run_update` | `{ fields }` | 更新任務狀態 |
| `plan` | `{ summary, tasks, estimatedCostUsd }` | 計畫與預估費用 |
| `task_created` | `{ taskId, parentTaskId, title, agent, position }` | 新增任務列 |
| `task_update` | `{ taskId, fields }` | 更新任務狀態 |
| `agent_message` | `{ taskId, text }` | agent 的中途說明 |
| `tool_call` | `{ taskId, tool, args }` | 活動紀錄 |
| `browser_result` | `{ taskId, tool, ok, denied, error }` | 瀏覽器動作紀錄 |
| `mention` | `{ fromTaskId, fromAgent, toTaskId, agent, request }` | 「@research 請幫忙……」 |
| `fallback` | `{ taskId?, stage?, provider, model, reason }` | 「改用備援模型」 |
| `usage` | `{ provider, model, input, output, costUsd, totalCostUsd }` | 累計費用 |
| `artifact` | `{ artifactId, name, kind, createdBy }` | 新增成果檔案 |
| `notice` | `{ text }` | 一般提示 |
| `mesh_dispatch` | `{ taskId, device, owner, mine, status, dispatchId?, text? }` | 主 agent 派工給某台裝置 |
| `mesh_report` | `{ taskId, device, owner, mine, status, text, costUsd }` | 子 agent 回報 |
| `mesh_question` | `{ taskId, dispatchId, text, direction }` | 子 agent 向主 agent 確認 |
| `mesh_answer` | `{ taskId, dispatchId, text, direction }` | 主 agent 的回答 |
| `run_finished` | `{ status, error? }` | 任務結束 |

**隱私：** 事件不包含 API key。`tool_call.args` 可能含使用者輸入的文字或網址，網站只能顯示給該帳號本人。

## 三、連線方式

見 [`cloud-api.md`](cloud-api.md)。網站用同一套帳號登入，以 Bearer token 呼叫 API；網站的網址要加進伺服器的 `WEBSITE_ORIGINS`，否則瀏覽器會擋下請求。

**離線：** 伺服器連不上時，擴充功能照常執行，並在本機排隊，之後補傳。

## 四、尚未決定

- 網站的技術選型與部署位置（由網站負責人決定）
- token 的有效期限與撤銷方式
