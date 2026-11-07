import { BROWSER_TOOLS, validateToolArgs } from '../core/tools.js';
import {
  approvalRequired,
  assessActionRisk,
  restrictedPageReason,
  validateNavigationUrl,
} from './risk.js';

const CONTENT_CHANNEL = 'cuemesh-content-v1';
const TAB_READY_TIMEOUT_MS = 15_000;
const TAB_READY_POLL_MS = 200;
const SCREENSHOT_OPTIONS = { format: 'jpeg', quality: 70 }; // PNG 在高解析螢幕可能超過模型的單張圖片上限

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOOL_BY_NAME = new Map(BROWSER_TOOLS.map((tool) => [tool.name, tool]));

function failure(error, extra = {}) {
  return { ok: false, error: String(error || '未知錯誤'), ...extra };
}

function messageFor(error, fallback) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function imageFromDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('截圖格式無效');
  return { mediaType: match[1], data: match[2] };
}

export function cropRectForDevicePixels(rect, devicePixelRatio, imageWidth, imageHeight) {
  const scale = Number(devicePixelRatio);
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (![scale, x, y, width, height].every(Number.isFinite) || scale <= 0 || width <= 0 || height <= 0) return null;

  const left = Math.max(0, Math.floor(x * scale));
  const top = Math.max(0, Math.floor(y * scale));
  const right = Math.min(imageWidth, Math.ceil((x + width) * scale));
  const bottom = Math.min(imageHeight, Math.ceil((y + height) * scale));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function blobToDataUrl(blob) {
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('無法讀取裁切後的截圖'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

async function cropDataUrl(dataUrl, rect, devicePixelRatio, viewportWidth) {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') {
    throw new Error('目前環境不支援區域截圖裁切');
  }
  const response = await fetch(dataUrl);
  const source = await response.blob();
  const bitmap = await createImageBitmap(source);
  try {
    const screenshotScale = Number(viewportWidth) > 0 ? bitmap.width / Number(viewportWidth) : devicePixelRatio;
    const crop = cropRectForDevicePixels(rect, screenshotScale, bitmap.width, bitmap.height);
    if (!crop) throw new Error('選取區域不在可見範圍內');

    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(crop.width, crop.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('無法建立截圖裁切畫布');
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
    }

    if (typeof document === 'undefined') throw new Error('目前環境不支援區域截圖裁切');
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法建立截圖裁切畫布');
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close?.();
  }
}

function validTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

export function createBrowserController({
  chromeApi = globalThis.chrome,
  requestApproval = null,
  getApprovalMode = () => 'always',
} = {}) {
  const runs = new Map();

  function requireChrome(path) {
    const value = path.split('.').reduce((result, key) => result?.[key], chromeApi);
    if (typeof value !== 'function') throw new Error('Chrome 瀏覽器 API 無法使用');
    return value;
  }

  async function activeTab() {
    const query = requireChrome('tabs.query');
    const tabs = await query.call(chromeApi.tabs, { active: true, currentWindow: true });
    const tab = tabs?.find((item) => validTabId(item?.id));
    if (!tab) throw new Error('找不到目前作用中的分頁');
    return tab;
  }

  async function currentTab(tab) {
    if (typeof chromeApi?.tabs?.get !== 'function') return tab;
    try {
      return await chromeApi.tabs.get(tab.id);
    } catch (error) {
      throw new Error(`無法取得分頁：${messageFor(error, '分頁可能已關閉')}`);
    }
  }

  async function resolveRunTab(runId, requestedTabId) {
    if (typeof runId !== 'string' || !runId) throw new Error('缺少任務識別碼');
    let binding = runs.get(runId);
    let candidate;

    if (requestedTabId !== null && requestedTabId !== undefined) {
      if (!validTabId(requestedTabId)) throw new Error('分頁識別碼無效');
      if (binding && !binding.tabIds.has(requestedTabId)) throw new Error('此任務不可操作其他分頁');
      // 核心會保留起始 tabId；開新分頁後仍要讓後續工具操作新分頁。
      candidate = binding?.activeTabId !== null && binding?.activeTabId !== undefined
        ? { id: binding.activeTabId }
        : { id: requestedTabId };
    } else if (binding?.activeTabId !== null && binding?.activeTabId !== undefined) {
      candidate = { id: binding.activeTabId };
    } else {
      candidate = await activeTab();
    }

    const tab = await currentTab(candidate);
    if (!validTabId(tab?.id)) throw new Error('分頁識別碼無效');
    if (!binding) {
      binding = { tabIds: new Set(), activeTabId: null };
      runs.set(runId, binding);
    }
    if (!binding.tabIds.has(tab.id) && binding.tabIds.size > 0) throw new Error('此任務不可操作其他分頁');
    binding.tabIds.add(tab.id);
    binding.activeTabId = tab.id;
    return tab;
  }

  function assertAllowedPage(tab) {
    const reason = restrictedPageReason(tab?.url);
    if (reason) throw new Error(reason);
  }

  async function ensureContent(tab) {
    assertAllowedPage(tab);
    // 每次都注入：同網址重新載入後舊的控制程式已消失，content.js 本身會避免重複安裝
    const executeScript = requireChrome('scripting.executeScript');
    try {
      await executeScript.call(chromeApi.scripting, { target: { tabId: tab.id }, files: ['content.js'] });
    } catch (error) {
      throw new Error(`無法注入頁面控制程式：${messageFor(error, '此頁面可能不允許操作')}`);
    }
  }

  // 導覽或點擊後頁面可能還在載入，這時讀到的是舊內容；逾時仍繼續，因為有些頁面的資源永遠載不完
  async function waitForTabReady(tab) {
    let latest = tab;
    const deadline = Date.now() + TAB_READY_TIMEOUT_MS;
    while (latest?.status === 'loading' && Date.now() < deadline) {
      await sleep(TAB_READY_POLL_MS);
      latest = await currentTab(latest);
    }
    return latest;
  }

  async function content(rawTab, command, args = {}) {
    const tab = await waitForTabReady(rawTab);
    await ensureContent(tab);
    const sendMessage = requireChrome('tabs.sendMessage');
    let response;
    try {
      response = await sendMessage.call(chromeApi.tabs, tab.id, { channel: CONTENT_CHANNEL, command, args });
    } catch (error) {
      throw new Error(`頁面控制程式沒有回應：${messageFor(error, '請重新整理頁面後再試')}`);
    }
    if (!response || typeof response !== 'object') throw new Error('頁面控制程式回傳格式無效');
    if (!response.ok) throw new Error(response.error || '頁面操作失敗');
    return response;
  }

  function approvalMode(runId) {
    try {
      // 依任務判斷：其他帳號派來的任務即使設定為 risky 也要逐步批准
      return getApprovalMode?.({ runId }) === 'risky' ? 'risky' : 'always';
    } catch {
      // 無法讀取設定時使用最嚴格模式，避免因設定錯誤而繞過批准。
      return 'always';
    }
  }

  async function request({ runId, tab, tool, args, assessment, element }) {
    if (!approvalRequired(assessment.risk, approvalMode(runId))) return { ok: true };
    if (typeof requestApproval !== 'function') return failure('尚未設定使用者批准介面', { denied: true });

    try {
      const answer = await requestApproval({
        runId,
        tool,
        args,
        risk: assessment.risk,
        reason: assessment.reason,
        url: tab.url,
        element: element ?? null,
      });
      // 使用者可能在任務取消後才按批准，這時不可再執行動作
      if (answer?.approved === true && !runs.has(runId)) return failure('任務已結束，動作未執行', { denied: true });
      if (answer?.approved === true) return { ok: true };
      return failure(answer?.note || '使用者未批准這個動作', { denied: true });
    } catch (error) {
      return failure(`批准程序失敗：${messageFor(error, '未知錯誤')}`);
    }
  }

  async function inspectTarget(tab, ref) {
    const inspected = await content(tab, 'inspect_ref', { ref });
    if (!inspected.element || typeof inspected.fingerprint !== 'string') throw new Error('找不到有效的頁面元素參照，請先重新取得快照');
    return inspected;
  }

  async function actOnRef({ runId, tab, tool, args, command }) {
    const inspected = await inspectTarget(tab, args.ref);
    const assessment = assessActionRisk({ tool, args, element: inspected.element, currentUrl: tab.url });
    if (assessment.denied) return failure(assessment.reason);
    const approved = await request({ runId, tab, tool, args, assessment, element: inspected.element });
    if (!approved.ok) return approved;
    const result = await content(tab, command, { ...args, expectedFingerprint: inspected.fingerprint });
    return { ok: true, text: result.text || '頁面動作已完成' };
  }

  async function execute({ runId, tabId = null, tool, args } = {}) {
    try {
      const definition = TOOL_BY_NAME.get(tool);
      if (!definition) return failure(`不支援的瀏覽器工具：${tool}`);
      const invalid = validateToolArgs(definition, args);
      if (invalid) return failure(invalid);
      const tab = await resolveRunTab(runId, tabId);
      assertAllowedPage(tab);

      if (tool === 'browser_snapshot') {
        const result = await content(tab, 'snapshot');
        return { ok: true, text: JSON.stringify(result.snapshot) };
      }

      if (tool === 'browser_screenshot') {
        const capture = requireChrome('tabs.captureVisibleTab');
        // captureVisibleTab 拍的是視窗目前顯示的分頁；不先切過去會把無關分頁的內容送給 AI
        if (tab.active === false) {
          await requireChrome('tabs.update').call(chromeApi.tabs, tab.id, { active: true });
          await sleep(150);
        }
        const dataUrl = await capture.call(chromeApi.tabs, tab.windowId, SCREENSHOT_OPTIONS);
        return { ok: true, image: imageFromDataUrl(dataUrl), text: '已擷取目前可見範圍的截圖' };
      }

      if (tool === 'browser_click') return actOnRef({ runId, tab, tool, args, command: 'click' });
      if (tool === 'browser_type') return actOnRef({ runId, tab, tool, args, command: 'type' });

      if (tool === 'browser_press_key') {
        const focus = await content(tab, 'inspect_focused');
        const assessment = assessActionRisk({ tool, args, element: focus.element, currentUrl: tab.url });
        if (assessment.denied) return failure(assessment.reason);
        const approved = await request({ runId, tab, tool, args, assessment, element: focus.element });
        if (!approved.ok) return approved;
        const result = await content(tab, 'press_key', args);
        return { ok: true, text: result.text || `已按下 ${args.key}` };
      }

      if (tool === 'browser_scroll') {
        const result = await content(tab, 'scroll', args);
        return { ok: true, text: result.text || '已捲動頁面' };
      }

      if (tool === 'browser_wait') {
        if (!Number.isFinite(args.seconds) || args.seconds < 0 || args.seconds > 10) return failure('等待秒數必須介於 0 到 10');
        await new Promise((resolve) => setTimeout(resolve, args.seconds * 1000));
        return { ok: true, text: `已等待 ${args.seconds} 秒` };
      }

      const validUrl = validateNavigationUrl(args.url);
      if (!validUrl.ok) return failure(validUrl.error);
      const assessment = assessActionRisk({ tool, args: { ...args, url: validUrl.url }, currentUrl: tab.url });
      if (assessment.denied) return failure(assessment.reason);
      const approved = await request({ runId, tab, tool, args: { ...args, url: validUrl.url }, assessment });
      if (!approved.ok) return approved;

      if (tool === 'browser_navigate') {
        const update = requireChrome('tabs.update');
        await update.call(chromeApi.tabs, tab.id, { url: validUrl.url });
        return { ok: true, text: `已導覽至 ${validUrl.url}` };
      }

      if (tool === 'browser_new_tab') {
        const create = requireChrome('tabs.create');
        const options = { url: validUrl.url, active: true };
        if (Number.isInteger(tab.windowId)) options.windowId = tab.windowId;
        const created = await create.call(chromeApi.tabs, options);
        if (!validTabId(created?.id)) return failure('無法建立新分頁');
        const binding = runs.get(runId);
        binding.tabIds.add(created.id);
        binding.activeTabId = created.id;
        return { ok: true, text: `已在新分頁開啟 ${validUrl.url}` };
      }

      return failure(`尚未實作的瀏覽器工具：${tool}`);
    } catch (error) {
      return failure(messageFor(error, '瀏覽器操作失敗'));
    }
  }

  async function captureContext(kind, { tabId = null } = {}) {
    // 失敗一律丟錯，讓 UI 顯示原因；回傳值只有情境物件或 null（使用者取消）
    try {
      if (!['selection', 'region', 'element', 'page'].includes(kind)) throw new Error('不支援的情境擷取類型');
      let tab;
      if (tabId !== null && tabId !== undefined) {
        if (!validTabId(tabId)) throw new Error('分頁識別碼無效');
        tab = await currentTab({ id: tabId });
      } else {
        tab = await activeTab();
      }
      assertAllowedPage(tab);
      const result = await content(tab, 'capture_context', { kind });
      if (result.cancelled) return null;

      const base = { type: kind, tabId: tab.id, url: result.url || tab.url, title: result.title || tab.title || '' };
      if (kind === 'region') {
        const capture = requireChrome('tabs.captureVisibleTab');
        await sleep(120); // 等框選覆蓋層從畫面上消失，避免被拍進去
        const screenshot = await capture.call(chromeApi.tabs, tab.windowId, SCREENSHOT_OPTIONS);
        const cropped = await cropDataUrl(screenshot, result.rect, result.devicePixelRatio, result.viewportWidth);
        return { ...base, image: imageFromDataUrl(cropped) };
      }
      if (result.text) return { ...base, text: result.text };
      return base;
    } catch (error) {
      throw new Error(messageFor(error, '擷取頁面情境失敗'));
    }
  }

  function releaseRun(runId) {
    runs.delete(runId);
  }

  return { execute, captureContext, releaseRun };
}
