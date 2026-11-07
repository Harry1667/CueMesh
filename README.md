# CueMesh

**One Cue. Every AI.**

CueMesh 是一個能實際操作瀏覽器的 Chrome 擴充功能。你指著畫面說出想做的事，它會把工作拆開，分給你已接上的多家 AI，再由各個 agent 協作完成。

可以把它想成「能操作瀏覽器、又能同時接多家 AI 組成 agent 團隊的 Claude 擴充功能」。

> 狀態：開發中，目前還沒有可用版本。專題 demo 版，前身代號為 OmniLayer。

## 它解決什麼問題

用 AI 工作時，時間常花在這三件事上：

- **重複解釋：** 反覆複製貼上、截圖，說明自己正在看什麼。
- **人工當中介：** 自己在 ChatGPT、Claude 之間轉貼內容，再整合結果。
- **最後一哩路：** AI 給了答案，操作網頁還是要自己動手。

CueMesh 的做法是：**使用者表達意圖，AI 取得情境、分工並動手執行。**

## 專案分成兩個模組

| 模組 | 目錄 | 負責人 | 做什麼 |
|---|---|---|---|
| 擴充功能 | `extension/` | Harry | 主要功能：擷取情境、操作瀏覽器、多 AI 分工、批准機制 |
| 帳號與協作伺服器 | `server/` | Harry | 帳號、裝置互聯、共享專案、跨裝置派工 |
| 網站 | `website/` | 同事 | 主控台、每個專案的狀態與進度，**帳號共用 `server/`，不另外做** |

網站透過 [`docs/cloud-api.md`](docs/cloud-api.md) 使用帳號與資料；資料格式見 [`docs/integration-contract.md`](docs/integration-contract.md)。要改規格請先跟對方講好。擴充功能沒登入時也能單機運作。

## 擴充功能的主要功能

- **指給 AI 看：** 反白文字、框選畫面區域、指定頁面元素，或分享整頁內容。
- **操作瀏覽器：** 讀取頁面、點擊、輸入、捲動、導覽與開新分頁。
- **自動分工：** 把目標拆成子任務，互不依賴的任務平行執行。
- **選模型與備援：** 依工作類型挑最適合的模型；該模型失敗或沒有 API key 時，自動換下一個。
- **Agent 互相委派：** agent 可以用 `@research`、`@coding` 請其他 agent 幫忙，使用者也能用 `@` 直接指定。
- **共用工作區：** agent 共用同一份成果，每個 agent 只拿到自己需要的情境。
- **帳號與互聯：** 同帳號多裝置同步、裝置之間派工、帳號之間共享專案與派工；主 agent 派工給其他裝置的子 agent，互相確認並回報。
- **使用者掌控：** 有風險的動作要先經過批准，並可以隨時取消、設定預算上限。

## 模型分工預設

目前支援 Anthropic Claude 與 OpenAI，依 [模型比較文件](docs/model-comparison.md)（查核日期 2026-11-07）在這兩家中選擇：

| 工作類型 | 首選模型 | 信心 |
|---|---|---|
| research：查資料 | `gpt-6.1-sol` | 中 |
| coding：寫程式 | `claude-opus-5-5` | 低～中 |
| 3d：Three.js 場景 | `claude-opus-5-5` | 低 |
| vision：看圖與截圖 | `gpt-6.1-terra` | 中 |
| planning：拆解任務 | `claude-opus-5-5` | 低 |
| review：審查成果 | `gpt-6.1-sol` | 低 |
| browser：操作瀏覽器 | `claude-opus-5-5` | 中～低 |

這是預設值，不是客觀排名。公開數據多由廠商自報，信心低的類別尤其如此，使用者可以自行調整。

## 重要設計決定

- **使用者自帶 API key：** 消費版訂閱通常不等於 API 權限，所以先走官方 API，費用依用量另計。
- **API key 不以明文離開瀏覽器：** 跨裝置同步採端對端加密，伺服器解不開，避免它成為存放金鑰的高風險目標。
- **遠端派工要對方同意：** 瀏覽器動作一律由實際執行的裝置批准，其他帳號的派工要逐次同意。
- **網頁內容一律視為不可信：** 頁面中的文字可能藏有提示注入，只能當資料，不能當指令。
- **密碼與付款欄位不代填：** 這類欄位一律由使用者親自輸入。

## 開發方式

需要 Node.js 22.13 以上與 Chrome。

```bash
git clone https://github.com/Harry1667/CueMesh.git
cd CueMesh
```

各模組的啟動方式寫在自己目錄的 README：

- 擴充功能：[`extension/README.md`](extension/README.md)（建立中）
- 網站：`website/README.md`（由網站負責人建立）

### 協作規則

1. **只改自己的目錄：** 擴充功能改 `extension/`，網站改 `website/`，這樣兩邊不會互相衝突。
2. **共用文件要先講：** 改 `docs/integration-contract.md` 前先跟對方確認，因為它會影響兩邊的實作。
3. **開分支、發 PR：** 不直接推 `main`，分支命名用 `ext/功能` 或 `web/功能`。
4. **不要提交機密：** API key、`.env`、金鑰檔都不能進版控。

## 目錄結構

```text
CueMesh/
├── extension/                  # 擴充功能（Harry）
├── server/                     # 帳號與協作伺服器（Harry）
├── website/                    # 網站（同事）
└── docs/
    ├── cloud-api.md            # 帳號與協作 API
    ├── integration-contract.md # 資料格式
    └── model-comparison.md     # 模型比較與路由依據
```
