// dev.html 用的靜態伺服器：瀏覽器不允許從 file:// 載入 ES module，所以需要一個本機伺服器。
// 只綁 127.0.0.1，只提供 extension/src 與 public 底下的檔案。
// 用法（在 extension/ 目錄）：node src/ui/dev-server.mjs [埠號]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowedDirs = [join(root, 'src') + sep, join(root, 'public') + sep];
const port = Number(process.argv[2]) || 5199;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = normalize(join(root, pathname));
  let isFile = false;
  try {
    isFile = allowedDirs.some((dir) => file.startsWith(dir)) && statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('找不到檔案');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`CueMesh 開發預覽：http://127.0.0.1:${port}/src/ui/dev.html`);
});
