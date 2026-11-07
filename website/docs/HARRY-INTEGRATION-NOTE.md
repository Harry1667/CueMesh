@Harry1667 網站前端對接資訊：

- 目前本機開發 origin：`http://127.0.0.1:4180`
- 介紹頁：`http://127.0.0.1:4180/`
- 工作頁：`http://127.0.0.1:4180/workspace`
- 請在開發環境的 `WEBSITE_ORIGINS` 加入精確 origin `http://127.0.0.1:4180`，不要加頁面路徑。`localhost` 與 `127.0.0.1` 是不同 origin；目前前端固定使用後者。

這是開發者自己電腦上的 loopback 網址，Harry 的電腦不能直接連到 Ethan 的本機服務，也不是 Oracle 正式網址。正式部署預定為 Oracle Cloud VM + Nginx；尚未提供公開網域／VM 網址，正式 `WEBSITE_ORIGINS` 要等部署網址確定後補上。

前端依 main commit `c03029375b14160bd9b39b65cd97e772d7416124` 的 `docs/cloud-api.md` 和 `docs/integration-contract.md` 調整：帳號統一由 `server/` 提供，網站只做註冊／登入介面，以 Bearer token 呼叫 `/api`，不另建帳號系統或 Supabase 專案。

請提供測試 API 的 base URL 與最後的公開網站 origin，方便完成真實連線測試。目前此 main commit 只有 API 文件，尚未包含 `server/` 實作。
