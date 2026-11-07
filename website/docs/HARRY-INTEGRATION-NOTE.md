@Harry1667 網站前端對接資訊：

- 目前本機開發 origin：`http://127.0.0.1:4180`
- 介紹頁：`http://127.0.0.1:4180/`
- 工作頁：`http://127.0.0.1:4180/workspace`
- 請在開發環境的 `WEBSITE_ORIGINS` 加入精確 origin `http://127.0.0.1:4180`，不要加頁面路徑。`localhost` 與 `127.0.0.1` 是不同 origin；目前前端固定使用後者。

這是開發者自己電腦上的 loopback 網址，Harry 的電腦不能直接連到 Ethan 的本機服務。公開網站已確認為 **https://cuemesh.looptw.com**；工作頁為 **https://cuemesh.looptw.com/workspace**。`WEBSITE_ORIGINS` 請使用精確 origin，不要加頁面路徑。

前端依 main commit `c03029375b14160bd9b39b65cd97e772d7416124` 的 `docs/cloud-api.md` 和 `docs/integration-contract.md` 調整：帳號統一由 `server/` 提供，網站只做註冊／登入介面，以 Bearer token 呼叫 `/api`，不另建帳號系統或 Supabase 專案。

2026-11-07 錄影前查核：公開 `/api/me` 回傳預期 JSON 401，對 `http://127.0.0.1:4180` 的 CORS 預檢回傳 204 與相符 origin。Vite 的開發與預覽 proxy 已改接上述公開 API；本機後端可用 `CUEMESH_API_TARGET=http://127.0.0.1:3000` 覆寫。這不是登入成功或跨裝置成功的證據。

後端／擴充功能已檢視 `ext/mvp` commit `361d413`。236 個 browser/core/cloud/UI 測試通過，使用模擬 provider；未跑真實金鑰、資料庫或兩台裝置。兩台裝置目前尚未連結完成。請依 [DEMO-RECORDING.md](DEMO-RECORDING.md) 確認同一伺服器、共享專案、雙方在線、同意與回報，再錄完整 demo。網站修正與查核記錄放在 [PR #2](https://github.com/Harry1667/CueMesh/pull/2)。
