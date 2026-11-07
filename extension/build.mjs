// 打包擴充功能到 dist/，Chrome 載入 dist/ 這個資料夾
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');

const options = {
  absWorkingDir: root,
  entryPoints: {
    background: 'src/background.js',
    sidepanel: 'src/ui/sidepanel.js',
    content: 'src/content/index.js',
    'theme-icon': 'src/theme-icon.js',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  sourcemap: 'linked',
  logLevel: 'info',
  // content.js 由 executeScript 注入成一般腳本，不能是 ESM；IIFE 也能避免變數外洩到頁面
  format: 'iife',
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
for (const file of ['sidepanel.html', 'preview-sandbox.html']) {
  const source = join(root, 'src/ui', file);
  if (!existsSync(source)) throw new Error(`找不到 ${source}`);
  await cp(source, join(out, file));
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('監看中：修改 src/ 會自動重新打包（HTML 與 manifest 需重新執行）');
} else {
  await build(options);
}
