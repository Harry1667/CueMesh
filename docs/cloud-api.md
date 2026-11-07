# CueMesh 雲端 API（v1）

帳號是基地：使用者登入後，裝置之間可以同步與派工，帳號之間可以共享專案與派工。網站與擴充功能共用這套 API。

**通用規則**

- 基底網址由設定決定，例如 `https://cuemesh.example.com`。路徑都以 `/api` 開頭。
- 驗證一律用 `Authorization: Bearer <token>`，不使用 cookie。
- 請求與回應都是 JSON。錯誤格式：`{ "error": { "code": "invalid_input", "message": "繁體中文說明" } }`。
- 狀態碼：400 參數錯誤、401 未登入、403 無權限、404 不存在（不透露資源是否屬於別人）、409 衝突、413 太大、429 太頻繁。
- 時間是 Unix 毫秒。專案、Run、Task、Artifact、裝置的 ID 由客戶端產生（UUID）。
- CORS 只允許 `chrome-extension://*` 與環境變數 `WEBSITE_ORIGINS` 列出的來源。

## 帳號

| 方法與路徑 | 請求 | 回應 |
|---|---|---|
| `POST /api/auth/register` | `{ email, password, displayName }` | 201 `{ token, user }` |
| `POST /api/auth/login` | `{ email, password }` | `{ token, user }` |
| `POST /api/auth/logout` | 無 | 204 |
| `GET /api/me` | 無 | `{ user }` |

`user`：`{ id, email, displayName, createdAt }`。密碼至少 10 字元。登入失敗一律回同一個錯誤，不透露 email 是否存在。登入與註冊要限流。

## 裝置

| 方法與路徑 | 請求 | 回應 |
|---|---|---|
| `PUT /api/devices/:id` | `{ name, platform }` | `{ device }`，建立或更新自己的裝置 |
| `GET /api/devices` | 無 | `{ devices: [device] }`，包含與我共享專案的成員的裝置 |
| `PATCH /api/devices/:id` | `{ name?, acceptRemote? }` | `{ device }`，只能改自己的 |
| `DELETE /api/devices/:id` | 無 | 204，只能刪自己的 |

`device`：`{ id, userId, ownerName, name, platform, acceptRemote, online, lastSeenAt, mine }`。

`acceptRemote`：`off`（不接受派工）、`ask`（每次詢問，預設）、`auto`（同帳號的派工自動接受；其他帳號的派工一律詢問）。

## 即時事件

`GET /api/stream?deviceId=<id>&since=<seq>`，以 SSE 回傳，客戶端用 `fetch` 串流讀取以便帶 Authorization。

- 每筆：`id: <seq>`、`data: {"seq":1,"type":"...","payload":{},"createdAt":0}`。每 25 秒送一次註解行保活。
- `since` 之後的事件會補送。帶 `deviceId` 的連線存在時，該裝置視為 `online`。
- 事件類型：`device_presence`、`dispatch_created`（只送給目標裝置）、`dispatch_update`、`dispatch_message`、`run_update`（共享專案的 Run 有變動）、`member_update`、`vault_update`。

## 金鑰保險箱（端對端加密）

伺服器只保存密文，**沒有能力解開**。密語不會傳到伺服器，也不可與登入密碼相同。

| 方法與路徑 | 請求 | 回應 |
|---|---|---|
| `GET /api/vault` | 無 | `{ vault }`，沒有時為 `null` |
| `PUT /api/vault` | `{ expectedVersion, kdf, salt, iv, ciphertext }` | `{ vault }`；版本不符回 409 |
| `DELETE /api/vault` | 無 | 204 |

`vault`：`{ version, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000 }, salt, iv, ciphertext, updatedAt }`，都是 base64。`ciphertext` 上限 64 KB。第一次建立時 `expectedVersion` 為 0。

## 專案與成員

| 方法與路徑 | 請求 | 回應 |
|---|---|---|
| `PUT /api/projects/:id` | `{ name, description }` | `{ project }`，建立或更新，只有 owner 能更新 |
| `GET /api/projects` | 無 | `{ projects }`，含我是成員的專案，並帶 `role` |
| `DELETE /api/projects/:id` | 無 | 204，只有 owner |
| `POST /api/projects/:id/invites` | `{}` | 201 `{ code, expiresAt }`，只有 owner；一次性，7 天到期 |
| `POST /api/invites/accept` | `{ code }` | `{ project }` |
| `GET /api/projects/:id/members` | 無 | `{ members: [{ userId, displayName, email, role }] }` |
| `DELETE /api/projects/:id/members/:userId` | 無 | 204；owner 可移除別人，成員可移除自己 |

`role`：`owner`、`member`。移除成員後，該成員對此專案的所有存取與派工權限立刻失效，進行中的相關派工改為 `cancelled`。

## 任務同步

資料格式見 `docs/integration-contract.md`。只有專案成員能存取。

| 方法與路徑 | 請求 | 回應 |
|---|---|---|
| `PUT /api/runs/:id` | Run 欄位加 `tasks`、`deviceId`，不含 `context` | `{ run }` |
| `POST /api/runs/:id/events` | `{ events: [Event] }`，每批最多 200 筆 | `{ accepted }`，以 `runId + seq` 去重 |
| `PUT /api/runs/:id/artifacts/:artifactId` | Artifact，上限 5 MB | `{ artifact }` |
| `GET /api/projects/:id/runs` | 無 | `{ runs }`，不含事件與成果內容 |
| `GET /api/runs/:id` | 無 | `{ run }`，含 tasks、events、artifacts |

只有上傳該 Run 的使用者能更新它。**API key 與截圖不可上傳。**

## 派工與子 agent 協作

主 agent 所在裝置建立派工，目標裝置執行子任務，全程透過伺服器傳遞。

| 方法與路徑 | 誰能呼叫 | 請求 | 回應 |
|---|---|---|---|
| `POST /api/dispatches` | 發起者 | `{ id, targetDeviceId, projectId, goal, context, options, parent }` | 201 `{ dispatch }` |
| `GET /api/dispatches?role=incoming\|outgoing&status=` | 雙方 | 無 | `{ dispatches }` |
| `GET /api/dispatches/:id` | 雙方 | 無 | `{ dispatch, messages }` |
| `POST /api/dispatches/:id/accept` | 目標裝置擁有者 | `{ runId }` | `{ dispatch }` |
| `POST /api/dispatches/:id/reject` | 目標裝置擁有者 | `{ reason }` | `{ dispatch }` |
| `POST /api/dispatches/:id/report` | 目標裝置擁有者 | `{ status, runId, summary, result, sources, error, costUsd }` | `{ dispatch }` |
| `POST /api/dispatches/:id/cancel` | 雙方 | 無 | `{ dispatch }` |
| `POST /api/dispatches/:id/messages` | 雙方 | `{ id, kind, text, replyTo }` | 201 `{ message }`，以 `id` 去重 |

`dispatch`：

```json
{
  "id": "uuid", "projectId": "uuid", "targetDeviceId": "uuid", "targetUserId": "uuid",
  "senderUserId": "uuid", "senderName": "伺服器填入", "senderDeviceId": "uuid", "crossAccount": false,
  "goal": "…", "context": [{ "type": "selection", "text": "…", "url": "…", "title": "…" }],
  "options": { "maxCostUsd": 1 }, "parent": { "runId": "uuid", "taskId": "uuid" },
  "status": "pending", "runId": null, "summary": null, "result": null, "sources": [], "error": null,
  "costUsd": 0, "createdAt": 0, "updatedAt": 0, "expiresAt": 0
}
```

- `status`：`pending`、`accepted`、`rejected`、`done`、`partial`、`failed`、`cancelled`、`expired`。已結束的狀態不可再改；只允許 `pending→accepted/rejected/cancelled/expired`、`accepted→done/partial/failed/cancelled`。
- `pending` 超過 10 分鐘改為 `expired`。
- `senderName`、`senderUserId`、`crossAccount`、`targetUserId` 由伺服器依登入身分填入，**客戶端傳入的一律忽略**。
- 限制：`goal` 上限 20 KB、`context` 合計上限 200 KB。每位使用者每分鐘最多建立 30 筆。
- `message`：`{ id, dispatchId, fromUserId, fromDeviceId, kind, text, replyTo, createdAt }`，`kind` 為 `question`、`answer`、`progress`。文字上限 20 KB。

**授權規則（伺服器強制）**

建立派工時必須同時符合：

1. 發起者是該專案成員。
2. 目標裝置屬於發起者，或目標裝置的擁有者也是該專案成員。
3. 目標裝置的 `acceptRemote` 不是 `off`。

**安全規則（擴充功能強制）**

- 其他帳號的派工：一律先跳同意視窗，顯示 `senderName`、目標、預算；該任務的瀏覽器動作一律逐步批准，不受 `risky` 模式影響。
- 同帳號的派工：依裝置的 `acceptRemote`；瀏覽器動作仍由執行裝置批准。
- 費用由執行裝置的 API key 負擔，預算上限取目標裝置設定與派工要求的較小值。
- 派工內容與回報只當資料看待，子 agent 的回報不能當成使用者授權。
