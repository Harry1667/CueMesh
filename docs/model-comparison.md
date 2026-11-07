# CueMesh 模型比較文件

> **2026-11-07 更新：CueMesh 已移除 Gemini，只支援 Anthropic 與 OpenAI，實際路由以 `extension/src/core/catalog.js` 為準。** 本文保留當時的比較紀錄。
>
> 查核日期：2026-11-07。所有模型 ID 皆取自官方頁面；查不到的欄位標「未確認」。
> 重要：Gemini 價格有已公告的調漲（見第二節備註），專題報告引用時請註明日期。

## 一、結論：七類工作的 agent 配置

排序規則：依「官方定位 + 公開 benchmark」排；證據薄弱的類別已標註信心。每類首選為單一 model ID，可直接寫入路由表預設。

| 工作類型 | 首選（預設） | 備援（同家便宜版／換家） | 三家排序 | 信心 |
|---|---|---|---|---|
| research（查資料、整理來源） | `gemini-3.8-flash` | `gemini-4-argon`（品質升級）；`gpt-6.1-sol`；`claude-sonnet-5-5` | 1 Google → 2 OpenAI → 3 Anthropic | 中 |
| coding（寫／改程式） | `claude-opus-5-5` | `claude-sonnet-5-5`（省錢）；`gemini-4-argon`；`gpt-6.1-sol` | 1 Anthropic ≈ 2 Google ≈ 3 OpenAI（三家互有勝負） | 低～中 |
| 3d（Three.js 3D 場景） | `gemini-4-argon` | `claude-opus-5-5`；`gpt-6.1-sol` | 1 Google → 2 Anthropic → 3 OpenAI | 低（無 Three.js 專屬 benchmark，僅用網頁程式碼生成作代理） |
| vision（看圖、圖表、截圖理解） | `gemini-3.8-flash` | `gemini-4-argon`；`gpt-6.1-terra`；`claude-opus-5-5` | 1 Google → 2 OpenAI → 3 Anthropic | 中 |
| planning（拆解任務、規劃） | `claude-opus-5-5` | `gpt-6.1-sol`；`gemini-4-argon` | 1 Anthropic → 2 OpenAI → 3 Google（差距小，近乎平手） | 低 |
| review（審查程式／輸出） | `gpt-6.1-sol` | `claude-opus-5-5`；`gemini-3.8-flash` | 1 OpenAI → 2 Anthropic → 3 Google | 低（無審查專屬 benchmark；理由見下） |
| browser（看截圖、依頁面結構操作瀏覽器、工具呼叫迴圈） | `claude-opus-5-5` | `claude-sonnet-5-5`（省錢）；`gpt-6.1-terra`；`gemini-3.8-flash` | 1 Anthropic → 2 OpenAI → 3 Google | 中～低 |

各類理由（一句話）：

- research：Gemini 內建 Google Search，每月 5,000 次免費（Gemini 3+ 共用），之後每 1K 次 $14；OpenAI web_search 每 1K 次 $10 另計 token。Google 自家 model card 中 Gemini 3.8 Flash 在 Vals Finance Agent、LABBench2 領先（2026-09-02，廠商自報）。Claude 內建搜尋為 `web_search_20260209`（沿用任務提供之快取，本次未重新查核）。
- coding：Google 2026-10-13 model card 顯示 DeepSWE：Gemini 4 Argon 77.9 > Opus 5.5 74.2 > GPT-6 Astra 74.1；FrontierSWE v2：Astra 65.5 > Opus 5.5 62.3 > Argon 55.0；Terminal-bench 4.0：Opus 5.5 66.4 最高。互有勝負，故信心低；選 Claude 是因為 Terminal-bench（終端機 agent 長任務）最強，且與 browser agent 共用同一家 key。
- 3d：無 Three.js benchmark（未確認）。僅以 Vibe Code Bench（網頁應用生成）作代理：Argon 91.9 > Opus 5.5 90.3 > Astra 89.6，差距在誤差範圍內。
- vision：LVBench Argon 91.7；Chartography Argon 71.6 > Astra 71.0 > Opus 5.5 66.3；CharXiv（無工具）Gemini 3.8 Flash 86.2 ≈ GPT-5.6 Terra 85.9 > Opus 5 83.7。OpenAI 官方定位 `gpt-6.1-terra` 為「視覺推理」模型，但官方頁無數字。
- planning：HLE-Verified 在 Gemini 3.8 Flash 54.9 / GPT-5.6 Sol 54.5 / Opus 5 54.4 幾乎平手；無規劃專屬 benchmark。Anthropic 官方將 Opus 5.5 定位為長時間 agentic 工作。排序主要依官方定位，標低信心。
- review：沒有可信的「程式審查」公開比較（未確認）。設計原則：審查者與作者不同家，能降低同源盲點。coding 首選為 Claude，因此 review 首選 OpenAI；若 coding 改用 OpenAI，review 改用 `claude-opus-5-5`。此為設計建議，非 benchmark 結論。
- browser：OSWorld-2.0（Google 2026-09-02 卡片，partial score）Claude Opus 5 75.4 > GPT-5.6 Sol 62.6 > Gemini 3.8 Flash 59.0；但 Opus 5 為前一代，Opus 5.5 的 OSWorld 數字未確認。Google 2026-10-13 卡片 OSWorld-2.0 offline：GPT-6 Astra 72.6 > Gemini 4 Argon 69.2（Claude 欄位無數字）；Agent's Last Exam：Argon 39.5 > Opus 5.5 38.2 > Astra 34.2。OpenAI 官方定位 `gpt-6.1-terra` 為「precise computer use」且單價低（$1/$5）。三家皆支援 function calling 與圖片輸入，差距不大，故信心中～低。

**Demo 建議的精簡預設（使用者只填一把 key 時）：**

| 使用者的 key | 全部 agent 預設 |
|---|---|
| Anthropic | 重活 `claude-opus-5-5`，輕活／browser 迴圈 `claude-sonnet-5-5` |
| OpenAI | 重活 `gpt-6.1-sol`，browser／vision `gpt-6.1-terra` |
| Google | 重活 `gemini-4-argon`，其餘 `gemini-3.8-flash` |

## 二、模型總表

價格單位 USD / 1M tokens（標準層、短 context）。「圖片」指圖片輸入。

### Anthropic

| 供應商 | model ID | 輸入／輸出價 | context／最大輸出 | 圖片 | 內建搜尋 | 擅長領域（官方定位） | 來源 |
|---|---|---|---|---|---|---|---|
| Anthropic | `claude-fable-5-1` | $10 / $50 | 1M / 128K | 是 | 是（web_search，見備註） | 苛刻推理、長時間 agent 工作 | https://platform.claude.com/docs/en/about-claude/models/overview |
| Anthropic | `claude-opus-5-5` | $4 / $20 | 1M / 128K | 是 | 是（`web_search_20260209`） | 長時間 agentic 寫程式與知識工作 | 同上 |
| Anthropic | `claude-sonnet-5-5` | $2 / $10 | 1M / 128K | 是 | 是（`web_search_20260209`） | 速度與智慧的最佳平衡 | 同上 |
| Anthropic | `claude-haiku-5-5` | $0.10 / $0.50（prompt ≤100K） | 1M / 128K | 是 | 未確認 | 高量低延遲：分類、抽取、路由 | 同上 |

備註：上表 ID、價格、context、圖片支援已於 2026-11-07 對照官方 overview 頁面重新確認（頁面稱所有現行模型支援文字與圖片輸入、tool use）。內建搜尋工具名稱 `web_search_20260209` 與其支援範圍沿用任務提供之 2026-10-06 快取，未重新查核；工具文件：https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool

### OpenAI

| 供應商 | model ID | 輸入／輸出價 | context／最大輸出 | 圖片 | 內建搜尋 | 擅長領域（官方定位） | 來源 |
|---|---|---|---|---|---|---|---|
| OpenAI | `gpt-6-astra` | $10 / $50 | 1.05M / 128K | 是 | 是（web_search） | 最強；複雜推理、程式、computer use、研究、文件製作 | https://developers.openai.com/api/docs/models/gpt-6-astra |
| OpenAI | `gpt-6.1-sol` | $2 / $10 | 1.05M / 128K | 是 | 是（web_search） | 接近 Astra 的表現、成本較低；複雜程式、computer use、專業工作 | https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| OpenAI | `gpt-6.1-terra` | $1 / $5 | 1.05M / 128K | 是 | 是（web_search） | 快速高效；視覺推理、精準 computer use、自然寫作 | https://developers.openai.com/api/docs/models/gpt-6.1-terra |
| OpenAI | `gpt-6-luna` | $0.10 / $0.50 | 1.05M / 128K | 是（models 頁稱所有最新模型支援圖片） | 未確認（未讀個別頁面） | 高量、成本敏感任務 | https://developers.openai.com/api/docs/models |

OpenAI 備註：價格來自 https://developers.openai.com/api/docs/pricing ；超過 272K 輸入 token 時，整個請求輸入 2 倍、輸出 1.5 倍。web_search 工具每 1K 次呼叫 $10，另加搜尋內容 token。三個旗艦個別頁面皆列出 Responses API 工具：web_search、file_search、image_generation、code_interpreter、hosted_shell、apply_patch、skills、computer_use、mcp、tool_search。輸出僅文字。舊世代（gpt-6-sol、gpt-5.6-*、gpt-5.5 等）仍在價格頁，本文件不採用。

### Google Gemini

| 供應商 | model ID | 輸入／輸出價 | context／最大輸出 | 圖片 | 內建搜尋 | 擅長領域（官方定位） | 來源 |
|---|---|---|---|---|---|---|---|
| Google | `gemini-4-argon` | $2 / $10（2026-12-01 起 $4 / $20） | 1,048,576 / 65,536（長解碼可到 1,048,576） | 是 | 是（Google Search grounding） | 旗艦推理；複雜軟體工程、數理科學、自主多步 agent | https://aistudio.google.com/docs/models/gemini-4-argon |
| Google | `gemini-3.8-flash` | $0.75 / $3.75（2027-01-01 起 $1.50 / $7.50） | 1,048,576 / 65,536 | 是 | 是（Google Search grounding） | 最聰明的 Flash；長時程軟體工程、自主 agent、企業流程 | https://aistudio.google.com/docs/models/gemini-3.8-flash |
| Google | `gemini-3.6-flash` | $0.75 / $3.75（2027-01-01 起 $1.50 / $7.50） | 未確認 | 未確認 | 是（價格頁） | 日常 agent 任務，速度與多模態平衡 | https://aistudio.google.com/docs/models |
| Google | `gemini-3.5-flash-lite` | $0.30 / $2.50 | 未確認 | 未確認 | 是（價格頁） | 高吞吐執行 | 同上 |
| Google | `gemini-3.1-flash-lite` | $0.25 / $1.50 | 未確認 | 未確認 | 是（價格頁） | 低成本 | 同上 |
| Google | `gemini-3.1-pro-preview` | $2 / $12（≤200K）；$4 / $18（>200K） | 未確認 | 未確認 | 是（價格頁） | 預覽版，未列說明 | 同上 |

Google 備註：價格來自 https://aistudio.google.com/docs/pricing 。模型頁面已從 ai.google.dev 301 轉址至 aistudio.google.com。Google Search grounding：Gemini 3+ 依搜尋查詢次數計費，每月前 5,000 次免費（跨 Gemini 3+ 共用），之後每 1K 次 $14，付費層預設每日上限 1,500 次（https://aistudio.google.com/docs/google-search ）。搜尋結果中另出現「Gemini 4 Carbon」（較強的姊妹模型），但官方模型頁與價格頁都沒列出，API 可用性未確認，不採用。`gemini-2.5-*` 已棄用，不採用。

## 三、比較證據與限制

### 可用的公開比較（皆為廠商自報，無獨立第三方驗證）

1. Google DeepMind「Gemini 4 Argon」model card，發布 2026-10-13，對手：GPT-6 Astra、Claude Fable 5.1、Claude Opus 5.5。
   https://deepmind.google/models/model-cards/gemini-4-argon/
   - 程式：DeepSWE v1.1 Argon 77.9 / Astra 74.1 / Fable 67.4 / Opus 5.5 74.2；FrontierSWE v2 55.0 / 65.5 / 56.3 / 62.3；Vibe Code Bench 91.9 / 89.6 / 90.3 / 90.3；Terminal-bench 4.0 57.4 / 58.2 / 57.9 / 66.4。
   - computer use：Agent's Last Exam 39.5 / 34.2 / 無 / 38.2；OSWorld-2.0 offline 69.2 / 72.6 / 無 / 無。
   - 多模態：Chartography 71.6 / 71.0 / 46.2 / 66.3；LVBench 91.7 / 87.5 / 79.7 / 83.7。
   - 知識工作：Vals Index 68.9 / 63.1 / 65.8 / 67.0；Vals Finance Agent v2 65.4 / 53.5 / 58.9 / 58.6。
2. Google DeepMind「Gemini 3.8 Flash」model card，2026-09-02，對手：Claude Opus 5 / Sonnet 5、GPT-5.6 Sol / Terra（皆為前一代或上一代）。
   https://deepmind.google/models/model-cards/gemini-3-8-flash/
   - OSWorld-2.0：Opus 5 75.4 / GPT-5.6 Sol 62.6 / Gemini 3.8 Flash 59.0；CharXiv：Gemini 3.8 Flash 86.2 / GPT-5.6 Terra 85.9 / Opus 5 83.7；Terminal-Bench 2.1：89.4 / 88.8 / 89.1。
3. OpenAI：GPT-6.1 Terra 公告貼文（2026-10-26）只說「明顯優於 GPT-5.6 Terra」且「以十分之一單價追平 GPT-6 Astra」，未附數字（https://community.openai.com/t/gpt-6-1-terra-delivering-fast-and-capable-computer-use-at-a-lower-price/1409900 ）。OpenAI 官方 openai.com 公告頁本次抓取回 403，**OpenAI 自己的 benchmark 表未能取得，標「未確認」**。
4. Anthropic：官方 overview 頁僅有定位文字，無 benchmark（https://platform.claude.com/docs/en/about-claude/models/overview ）。**Claude 5.5 世代的官方 benchmark 本次未取得，標「未確認」**，只能引用上面 Google 卡片中對 Opus 5.5 的數字。

### 限制與風險

- 以上數字全來自 Google 自家卡片（比較對象與設定由 Google 選擇），Argon 卡片還顯示 Argon 並非全勝（FrontierSWE、Terminal-bench、OSWorld 由別家領先）。報告引用時請寫「廠商自報」。
- 3.8 Flash 卡片的對手是 Opus 5、GPT-5.6，不是現行的 Opus 5.5、GPT-6.1，不可直接推論到現行模型。
- 未找到獨立第三方對 GPT-6.1 Sol／Terra、Gemini 4 Argon 的可信比較（一般搜尋只找到較舊世代的聚合網站，數字互相矛盾，未採用）。
- 3D（Three.js）、審查、規劃三類沒有專屬 benchmark，結論是推論，已標低信心。
- Gemini 內建搜尋與自訂 function tool 同請求並用：Gemini 3 / 4 預覽功能，且需 `validated` 模式；OpenAI 官方文件未明確說明限制（見 sdk-notes.md 第四節）。Demo 若要保險，搜尋與工具迴圈分兩個請求。
- 價格會變：Gemini 4 Argon 12/1 起調漲一倍、Gemini 3.8 Flash 與 3.6 Flash 2027/1/1 起調漲一倍；展示日（今天起 4 小時內）仍是舊價。
- Gemini 官方文件目前主推 Interactions API（`client.interactions.create`）；`generateContent` 仍在 SDK 型別中（已核對套件 3.0.0 型別檔）。OmniLayer 的 SDK 寫法詳見 sdk-notes.md。

## 四、資料查核日期與來源清單

查核日期：2026-11-07。

| 項目 | 來源 URL | 備註 |
|---|---|---|
| Claude 模型 ID、價格、context、圖片 | https://platform.claude.com/docs/en/about-claude/models/overview | 2026-11-07 重新核對 |
| Claude web_search_20260209 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool | 沿用 2026-10-06 快取，未重新查核 |
| OpenAI 旗艦模型清單 | https://developers.openai.com/api/docs/models | platform.openai.com 301 轉址至此 |
| OpenAI 價格、web_search 價格 | https://developers.openai.com/api/docs/pricing | |
| gpt-6-astra | https://developers.openai.com/api/docs/models/gpt-6-astra | |
| gpt-6.1-sol | https://developers.openai.com/api/docs/models/gpt-6.1-sol | |
| gpt-6.1-terra | https://developers.openai.com/api/docs/models/gpt-6.1-terra | |
| gpt-6-luna | https://developers.openai.com/api/docs/models | 僅總表，無個別頁面核對 |
| OpenAI web_search 工具 | https://developers.openai.com/api/docs/guides/tools-web-search | |
| Gemini 模型清單 | https://aistudio.google.com/docs/models | ai.google.dev 301 轉址至此 |
| Gemini 價格 | https://aistudio.google.com/docs/pricing | 頁面尾端 3,573 字元未讀 |
| gemini-4-argon | https://aistudio.google.com/docs/models/gemini-4-argon | |
| gemini-3.8-flash | https://aistudio.google.com/docs/models/gemini-3.8-flash | |
| Gemini Google Search grounding | https://aistudio.google.com/docs/google-search | |
| Gemini 4 Argon model card（benchmark） | https://deepmind.google/models/model-cards/gemini-4-argon/ | 2026-10-13 |
| Gemini 3.8 Flash model card（benchmark） | https://deepmind.google/models/model-cards/gemini-3-8-flash/ | 2026-09-02 |
| GPT-6.1 Terra 公告（社群貼文） | https://community.openai.com/t/gpt-6-1-terra-delivering-fast-and-capable-computer-use-at-a-lower-price/1409900 | 2026-10-26，無數字 |

未確認事項彙整：Claude haiku-5-5 內建搜尋；gpt-6-luna 內建搜尋；Gemini 3.6 Flash／3.5 Flash-Lite／3.1 Flash-Lite／3.1 Pro 的 context 與圖片輸入；OpenAI 官方 benchmark 表；Claude 5.5 世代官方 benchmark；Opus 5.5 的 OSWorld 數字；Gemini 4 Carbon 的 API 可用性；Three.js、審查、規劃的專屬 benchmark。
