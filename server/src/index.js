import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const port = Number(process.env.PORT || 3000);
const databasePath = process.env.DATABASE_PATH || './data/cuemesh.sqlite';
if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });
const database = createDatabase(databasePath);
const app = createApp({ database });
const server = app.listen(port, () => {
  console.log(`CueMesh API 已啟動於 ${port}`);
});

function close() {
  app.locals.close?.();
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
