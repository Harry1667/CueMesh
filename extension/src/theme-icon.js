// Offscreen 文件：service worker 沒有 matchMedia，由這裡偵測深淺色並通知它換圖示
const query = matchMedia('(prefers-color-scheme: dark)');
const report = () => {
  chrome.runtime.sendMessage({ type: 'cuemesh:color-scheme', dark: query.matches }).catch((err) => {
    console.error('CueMesh：回報深淺色失敗', err);
  });
};
query.addEventListener('change', report);
report();
