import { createApp } from './app.js';
import { createDatabase } from './database.js';

const port = Number(process.env.PORT || 3000);

// 連線字串含密碼，錯誤訊息一律不輸出原文
async function main() {
  const database = createDatabase();
  const app = await createApp({ database });
  const server = app.listen(port, () => {
    console.log(`CueMesh API 已啟動於 ${port}`);
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.locals.close?.();
    server.close(async () => {
      await database.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

main().catch((error) => {
  console.error('CueMesh API 啟動失敗', error?.code ?? error?.name ?? '未知錯誤');
  process.exit(1);
});
