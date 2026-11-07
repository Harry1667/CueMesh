# CueMesh 雲端協作伺服器

這是 CueMesh 的帳號、專案同步、派工與 SSE 伺服器。它使用 Node ESM、Express 與 Node 內建的 `node:sqlite`，不需要原生 SQLite npm 套件。

## 安全與資料範圍

- 密碼以 `scrypt` 雜湊；Bearer token 只保存 SHA-256 雜湊，登出即撤銷目前 token。
- 保險箱只儲存端對端加密密文，服務不會解密、輸出或寫入日誌。
- Run、Artifact、Dispatch 的必要內容會保存以支援同步與協作；服務不會將任務、token、密碼或保險箱內容寫入日誌／分析資料。
- 資源授權一律由 Bearer token 與即時 project membership 強制判斷。跨帳號且非成員的資源使用相同 `404` 回應，避免洩漏存在性。
- API key、截圖欄位與 Run `context` 上傳會被拒絕。Artifact 上限 5 MB，保險箱密文上限 64 KB。

## 本機啟動

需要 Node.js 24 以上（必須提供 `node:sqlite`）。

```bash
cd server
cp .env.example .env
npm install
DATABASE_PATH=./data/cuemesh.sqlite npm start
```

環境變數：

| 名稱 | 說明 |
| --- | --- |
| `PORT` | HTTP 服務連接埠，預設 `3000`。 |
| `DATABASE_PATH` | SQLite 檔案路徑；測試可用 `:memory:`。 |
| `WEBSITE_ORIGINS` | 逗號分隔的精確網站 Origin allowlist，例如 `https://app.example.com`。 |
| `TRUST_PROXY` | 只有服務位於受信任反向代理之後才設 `true` 或 hop 數字；否則設 `false`。 |

Chrome extension Origin 僅接受實際 Chrome extension ID 格式的 `chrome-extension://<32-char-id>`，不會使用 `*`。

## 測試

```bash
cd server
npm test
```

測試會真的啟動 loopback HTTP server，涵蓋帳號隔離、404 不洩漏、派工狀態機、版本衝突、SSE 補送／presence、限流與 CORS。

## Docker Compose

```bash
cd server
cp .env.example .env
docker compose up --build -d
```

Compose 將 API 綁定為 `127.0.0.1:${HOST_PORT:-3000}`，不直接暴露到公網；SQLite 放在具名 volume `cuemesh-data`。備份前先停止容器，或使用 SQLite 的線上備份機制，避免直接複製正在寫入的 WAL 資料庫。

不要把 `.env`、SQLite volume 或 Docker socket 公開。正式網站必須透過 HTTPS 反向代理，再由代理轉送到 loopback port。

## Nginx 反向代理

以下範例假設 Nginx 與 Compose 在同一台主機，且 TLS 已設定。使用 `X-Forwarded-*` 時，將 `.env` 的 `TRUST_PROXY=true` 設定為只信任這個 Nginx。

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    # ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location /api/stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`/api/stream` 必須停用 buffering，否則 SSE 事件與 25 秒 heartbeat 會被 Nginx 暫存，客戶端會誤判離線。

## 營運限制

- SSE presence 使用目前 Node process 的記憶體；多實例部署前需加入共享 pub/sub 或改為單一 API replica。
- `DATABASE_PATH` 指向的目錄必須可寫。SQLite 適合單主機／單 volume；水平擴展前應遷移至支援併發的資料庫與事件匯流排。
- 服務本身不會代替擴充功能批准瀏覽器動作；跨帳號派工仍必須由目標裝置顯示批准 UI。
