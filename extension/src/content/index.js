import { isSensitiveField } from '../browser/risk.js';

const CONTENT_CHANNEL = 'cuemesh-content-v1';
const OVERLAY_ATTRIBUTE = 'data-cuemesh-capture-overlay';
const MAX_TEXT_LENGTH = 20_000;
const MAX_INTERACTIVE_ELEMENTS = 250;
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="tab"]',
  '[role="menuitem"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function normalizePageText(value, limit = MAX_TEXT_LENGTH) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function attribute(element, name) {
  return element?.getAttribute?.(name) ?? '';
}

function tagName(element) {
  return String(element?.tagName ?? '').toLowerCase();
}

function textFromIds(documentRef, ids) {
  return String(ids ?? '').split(/\s+/).filter(Boolean)
    .map((id) => documentRef.getElementById?.(id)?.textContent ?? '')
    .join(' ');
}

function labelText(element, documentRef) {
  const labelledBy = textFromIds(documentRef, attribute(element, 'aria-labelledby'));
  if (labelledBy) return normalizePageText(labelledBy, 500);
  const id = attribute(element, 'id');
  if (id && documentRef.querySelector) {
    const labels = [...documentRef.querySelectorAll('label')]
      .filter((label) => attribute(label, 'for') === id)
      .map((label) => label.textContent)
      .join(' ');
    if (labels) return normalizePageText(labels, 500);
  }
  const wrappingLabel = element?.closest?.('label');
  return normalizePageText(wrappingLabel?.textContent, 500);
}

function roleFor(element) {
  const role = attribute(element, 'role');
  if (role) return role;
  const tag = tagName(element);
  const type = String(element?.type ?? attribute(element, 'type')).toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || ['button', 'submit', 'reset'].includes(type)) return 'button';
  if (tag === 'textarea' || ['text', 'search', 'email', 'url', 'tel', 'number'].includes(type)) return 'textbox';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (tag === 'select') return 'combobox';
  if (element?.isContentEditable) return 'textbox';
  return tag || 'element';
}

export function isElementVisible(element, windowRef = globalThis.window) {
  if (!element?.isConnected || element.hidden || attribute(element, 'aria-hidden') === 'true') return false;
  const style = windowRef?.getComputedStyle?.(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
  const rect = element.getBoundingClientRect?.();
  return !rect || (rect.width > 0 && rect.height > 0);
}

function elementState(element) {
  const state = [];
  if (element?.disabled || attribute(element, 'aria-disabled') === 'true') state.push('disabled');
  if (element?.checked || attribute(element, 'aria-checked') === 'true') state.push('checked');
  if (element?.selected || attribute(element, 'aria-selected') === 'true') state.push('selected');
  if (attribute(element, 'aria-expanded')) state.push(`expanded:${attribute(element, 'aria-expanded')}`);
  if (element?.required || attribute(element, 'aria-required') === 'true') state.push('required');
  if (element?.readOnly || attribute(element, 'aria-readonly') === 'true') state.push('readonly');
  return state;
}

function editable(element) {
  const tag = tagName(element);
  const type = String(element?.type ?? attribute(element, 'type')).toLowerCase();
  if (element?.disabled || element?.readOnly) return false;
  if (tag === 'textarea' || element?.isContentEditable) return true;
  if (tag === 'select') return true;
  return tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image'].includes(type);
}

export function describeElement(element, { ref = null, documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const tag = tagName(element);
  const type = String(element?.type ?? attribute(element, 'type')).toLowerCase();
  const ariaLabel = attribute(element, 'aria-label');
  const label = labelText(element, documentRef);
  const text = normalizePageText(element?.innerText ?? element?.textContent, 500);
  const placeholder = attribute(element, 'placeholder');
  const title = attribute(element, 'title');
  const name = normalizePageText(ariaLabel || label || text || placeholder || title || attribute(element, 'alt'), 500);
  const descriptor = {
    ref,
    tag,
    role: roleFor(element),
    name,
    state: elementState(element),
    type,
    fieldName: attribute(element, 'name'),
    id: attribute(element, 'id'),
    autocomplete: attribute(element, 'autocomplete'),
    ariaLabel,
    ariaLabelledby: attribute(element, 'aria-labelledby'),
    label,
    placeholder,
    text,
    href: element?.href || attribute(element, 'href'),
    formAction: element?.formAction || attribute(element, 'formaction') || element?.form?.action || '',
    formSubmit: Boolean(
      (tag === 'button' && element?.form && (!type || type === 'submit'))
      || (tag === 'input' && ['submit', 'image'].includes(type)),
    ),
    form: Boolean(element?.form),
    hidden: !isElementVisible(element, windowRef),
    editable: editable(element),
  };
  descriptor.sensitive = isSensitiveField(descriptor);
  return descriptor;
}

export function elementFingerprint(descriptor) {
  return [
    descriptor.tag, descriptor.role, descriptor.type, descriptor.fieldName, descriptor.id,
    descriptor.autocomplete, descriptor.ariaLabel, descriptor.label, descriptor.name,
    descriptor.href, descriptor.formAction, descriptor.formSubmit, descriptor.hidden,
  ].map((part) => String(part ?? '')).join('\u001f');
}

function pageText(documentRef) {
  return normalizePageText(documentRef?.body?.innerText ?? documentRef?.body?.textContent);
}

function selectionIsSensitive(selection, documentRef, windowRef) {
  const node = selection?.anchorNode;
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const field = element?.closest?.('input, textarea');
  return field ? isSensitiveField(describeElement(field, { documentRef, windowRef })) : false;
}

function selectionText(windowRef, documentRef) {
  const selection = windowRef.getSelection?.();
  if (!selection || selection.rangeCount === 0) return '';
  if (selectionIsSensitive(selection, documentRef, windowRef)) throw new Error('不可擷取密碼或付款欄位內容');
  return normalizePageText(selection.toString());
}

function focusElement(documentRef) {
  let current = documentRef.activeElement;
  while (current?.shadowRoot?.activeElement) current = current.shadowRoot.activeElement;
  return current;
}

// 下拉選單接受選項的值或顯示文字；找不到就明確失敗，不要默默留在原選項
function resolveSelectValue(element, text) {
  const wanted = normalizePageText(text);
  const option = [...(element.options ?? [])].find((o) => o.value === text || normalizePageText(o.textContent) === wanted);
  if (!option) throw new Error(`下拉選單沒有「${wanted}」這個選項`);
  return option.value;
}

function setNativeValue(element, rawText, documentRef = globalThis.document) {
  const tag = tagName(element);
  const text = tag === 'select' ? resolveSelectValue(element, rawText) : rawText;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const prototype = tag === 'textarea'
      ? globalThis.HTMLTextAreaElement?.prototype
      : tag === 'select'
        ? globalThis.HTMLSelectElement?.prototype
        : globalThis.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, text);
    else element.value = text;
  } else if (element?.isContentEditable) {
    // 富文字編輯器靠 beforeinput 同步內部狀態，直接改 textContent 會在送出時遺失內容
    documentRef.getSelection?.()?.selectAllChildren?.(element);
    if (!documentRef.execCommand?.('insertText', false, text)) element.textContent = text;
  } else {
    throw new Error('此元素不可輸入文字');
  }
  const eventOptions = { bubbles: true, composed: true };
  element.dispatchEvent?.(new Event('input', eventOptions));
  element.dispatchEvent?.(new Event('change', eventOptions));
}

function createOverlay(documentRef, windowRef, label, interactive) {
  const host = documentRef.createElement('div');
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('pointer-events', interactive ? 'auto' : 'none', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = documentRef.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .cue { box-sizing: border-box; position: fixed; top: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 10px 14px; border-radius: 9px; background: #111827; color: #fff; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / 0.28); }
    .region, .outline { box-sizing: border-box; position: fixed; pointer-events: none; border: 2px solid #60a5fa; background: rgb(96 165 250 / 0.14); }
    .outline { border-style: dashed; background: rgb(96 165 250 / 0.08); }
  `;
  const message = documentRef.createElement('div');
  message.className = 'cue';
  message.textContent = label;
  const marker = documentRef.createElement('div');
  marker.className = interactive ? 'region' : 'outline';
  marker.hidden = true;
  shadow.append(style, message, marker);
  documentRef.documentElement.append(host);
  return { host, marker, setLabel: (value) => { message.textContent = value; }, remove: () => host.remove(), windowRef };
}

function rectangle(start, end, windowRef) {
  const x1 = Math.max(0, Math.min(start.x, end.x));
  const y1 = Math.max(0, Math.min(start.y, end.y));
  const x2 = Math.min(windowRef.innerWidth, Math.max(start.x, end.x));
  const y2 = Math.min(windowRef.innerHeight, Math.max(start.y, end.y));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function paintMarker(marker, rect) {
  marker.hidden = false;
  marker.style.left = `${rect.x}px`;
  marker.style.top = `${rect.y}px`;
  marker.style.width = `${rect.width}px`;
  marker.style.height = `${rect.height}px`;
}

export function createContentController({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const state = { refs: new Map(), capture: null };

  function invalidateRefs() {
    state.refs.clear();
  }

  // 不用 MutationObserver 全部作廢：廣告、動畫隨時在改 DOM，那樣 agent 在動態網站上會永遠點不到。
  // 安全由 resolvedRef 逐一檢查元素仍存在、可見且 fingerprint 未變來保證。
  windowRef?.addEventListener?.('popstate', invalidateRefs, true);
  windowRef?.addEventListener?.('hashchange', invalidateRefs, true);

  function snapshot() {
    invalidateRefs();
    const elements = [];
    const candidates = [...documentRef.querySelectorAll(INTERACTIVE_SELECTOR)];
    for (const element of candidates) {
      if (elements.length >= MAX_INTERACTIVE_ELEMENTS) break;
      if (!isElementVisible(element, windowRef) || element.closest?.(`[${OVERLAY_ATTRIBUTE}]`)) continue;
      const ref = `e${elements.length + 1}`;
      const descriptor = describeElement(element, { ref, documentRef, windowRef });
      const fingerprint = elementFingerprint(descriptor);
      state.refs.set(ref, { element, fingerprint });
      elements.push({ ref, role: descriptor.role, name: descriptor.name, state: descriptor.state });
    }
    return { url: windowRef.location.href, title: documentRef.title, text: pageText(documentRef), elements };
  }

  function resolvedRef(ref, expectedFingerprint) {
    const saved = state.refs.get(ref);
    if (!saved || !saved.element?.isConnected || !isElementVisible(saved.element, windowRef)) {
      throw new Error('元素參照已過期，請先重新取得頁面快照');
    }
    const descriptor = describeElement(saved.element, { ref, documentRef, windowRef });
    const fingerprint = elementFingerprint(descriptor);
    if (fingerprint !== saved.fingerprint || (expectedFingerprint && expectedFingerprint !== fingerprint)) {
      invalidateRefs();
      throw new Error('元素在批准前已變更，請先重新取得頁面快照');
    }
    return { element: saved.element, descriptor, fingerprint };
  }

  function finishCapture(current, payload) {
    if (state.capture !== current) return;
    state.capture = null;
    current.cleanup?.();
    current.resolve(payload);
  }

  function beginSelectionCapture() {
    const existing = selectionText(windowRef, documentRef);
    if (existing) return Promise.resolve({ ok: true, text: existing, url: windowRef.location.href, title: documentRef.title });
    return new Promise((resolve) => {
      const overlay = createOverlay(documentRef, windowRef, '請在頁面上選取文字，按 Esc 取消', false);
      const current = { resolve, cleanup: null };
      const cancel = () => finishCapture(current, { ok: true, cancelled: true });
      const acceptSelection = () => {
        try {
          const text = selectionText(windowRef, documentRef);
          if (text) finishCapture(current, { ok: true, text, url: windowRef.location.href, title: documentRef.title });
        } catch (error) {
          finishCapture(current, { ok: false, error: error.message });
        }
      };
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      };
      documentRef.addEventListener('selectionchange', acceptSelection, true);
      documentRef.addEventListener('keydown', onKey, true);
      current.cleanup = () => {
        documentRef.removeEventListener('selectionchange', acceptSelection, true);
        documentRef.removeEventListener('keydown', onKey, true);
        overlay.remove();
      };
      state.capture = current;
    });
  }

  function beginRegionCapture() {
    return new Promise((resolve) => {
      const overlay = createOverlay(documentRef, windowRef, '拖曳以框選要交給 CueMesh 的區域，按 Esc 取消', true);
      const current = { resolve, cleanup: null };
      let start = null;
      const cancel = () => finishCapture(current, { ok: true, cancelled: true });
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      };
      const onDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        start = { x: event.clientX, y: event.clientY };
        overlay.host.setPointerCapture?.(event.pointerId);
      };
      const onMove = (event) => {
        if (!start) return;
        const rect = rectangle(start, { x: event.clientX, y: event.clientY }, windowRef);
        paintMarker(overlay.marker, rect);
      };
      const onUp = (event) => {
        if (!start) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = rectangle(start, { x: event.clientX, y: event.clientY }, windowRef);
        start = null;
        if (rect.width < 3 || rect.height < 3) {
          overlay.setLabel('框選區域太小，請再拖曳一次，或按 Esc 取消');
          overlay.marker.hidden = true;
          return;
        }
        finishCapture(current, {
          ok: true,
          rect,
          devicePixelRatio: windowRef.devicePixelRatio || 1,
          viewportWidth: windowRef.innerWidth,
          url: windowRef.location.href,
          title: documentRef.title,
        });
      };
      documentRef.addEventListener('keydown', onKey, true);
      overlay.host.addEventListener('pointerdown', onDown, true);
      overlay.host.addEventListener('pointermove', onMove, true);
      overlay.host.addEventListener('pointerup', onUp, true);
      current.cleanup = () => {
        documentRef.removeEventListener('keydown', onKey, true);
        overlay.host.removeEventListener('pointerdown', onDown, true);
        overlay.host.removeEventListener('pointermove', onMove, true);
        overlay.host.removeEventListener('pointerup', onUp, true);
        overlay.remove();
      };
      state.capture = current;
    });
  }

  function elementBelow(overlay, x, y) {
    const pointerEvents = overlay.host.style.pointerEvents;
    overlay.host.style.setProperty('pointer-events', 'none', 'important');
    const target = documentRef.elementFromPoint(x, y);
    overlay.host.style.setProperty('pointer-events', pointerEvents || 'auto', 'important');
    return target;
  }

  function beginElementCapture() {
    return new Promise((resolve) => {
      const overlay = createOverlay(documentRef, windowRef, '點選要交給 CueMesh 的元素，按 Esc 取消', true);
      const current = { resolve, cleanup: null };
      let candidate = null;
      const cancel = () => finishCapture(current, { ok: true, cancelled: true });
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      };
      const update = (event) => {
        candidate = elementBelow(overlay, event.clientX, event.clientY);
        const bounds = candidate?.getBoundingClientRect?.();
        if (bounds && bounds.width > 0 && bounds.height > 0) paintMarker(overlay.marker, bounds);
        else overlay.marker.hidden = true;
      };
      const choose = (event) => {
        event.preventDefault();
        event.stopPropagation();
        update(event);
        if (!candidate) return;
        const descriptor = describeElement(candidate, { documentRef, windowRef });
        const text = descriptor.sensitive
          ? '此為密碼或付款相關欄位，CueMesh 未擷取其內容。'
          : `元素角色：${descriptor.role}\n名稱：${descriptor.name || '未命名'}\n文字：${descriptor.text || '無'}`;
        finishCapture(current, { ok: true, text, url: windowRef.location.href, title: documentRef.title });
      };
      documentRef.addEventListener('keydown', onKey, true);
      overlay.host.addEventListener('pointermove', update, true);
      overlay.host.addEventListener('click', choose, true);
      current.cleanup = () => {
        documentRef.removeEventListener('keydown', onKey, true);
        overlay.host.removeEventListener('pointermove', update, true);
        overlay.host.removeEventListener('click', choose, true);
        overlay.remove();
      };
      state.capture = current;
    });
  }

  async function captureContext(kind) {
    if (state.capture) return { ok: false, error: '已有進行中的情境擷取，請先完成或按 Esc 取消' };
    if (kind === 'page') return { ok: true, text: pageText(documentRef), url: windowRef.location.href, title: documentRef.title };
    if (kind === 'selection') return beginSelectionCapture();
    if (kind === 'region') return beginRegionCapture();
    if (kind === 'element') return beginElementCapture();
    return { ok: false, error: '不支援的情境擷取類型' };
  }

  async function handle({ command, args = {} } = {}) {
    try {
      if (command === 'snapshot') return { ok: true, snapshot: snapshot() };
      if (command === 'inspect_ref') {
        const found = resolvedRef(args.ref);
        return { ok: true, element: found.descriptor, fingerprint: found.fingerprint };
      }
      if (command === 'inspect_focused') {
        const element = focusElement(documentRef);
        return { ok: true, element: element ? describeElement(element, { documentRef, windowRef }) : null };
      }
      if (command === 'click') {
        const found = resolvedRef(args.ref, args.expectedFingerprint);
        if (found.element.disabled) throw new Error('此元素目前無法點擊');
        found.element.scrollIntoView?.({ block: 'center', inline: 'center' });
        found.element.focus?.({ preventScroll: true });
        found.element.click?.();
        invalidateRefs();
        return { ok: true, text: `已點擊「${found.descriptor.name || found.descriptor.role}」` };
      }
      if (command === 'type') {
        const found = resolvedRef(args.ref, args.expectedFingerprint);
        if (found.descriptor.sensitive) throw new Error('密碼與付款欄位必須由使用者親自輸入');
        if (!found.descriptor.editable) throw new Error('此元素不可輸入文字');
        found.element.focus?.({ preventScroll: true });
        setNativeValue(found.element, args.text, documentRef);
        return { ok: true, text: '已輸入文字' };
      }
      if (command === 'press_key') {
        const target = focusElement(documentRef) || documentRef.body;
        if (!target) throw new Error('找不到可接收按鍵的頁面元素');
        const descriptor = describeElement(target, { documentRef, windowRef });
        if (descriptor.sensitive) throw new Error('密碼與付款欄位必須由使用者親自輸入');
        const notPrevented = ['keydown', 'keypress', 'keyup']
          .map((type) => target.dispatchEvent?.(new KeyboardEvent(type, { key: args.key, bubbles: true, composed: true, cancelable: true })))
          .every((result) => result !== false);
        invalidateRefs();
        // 腳本模擬的按鍵不會觸發瀏覽器預設行為，Enter 要自己補上，否則搜尋與表單會默默沒反應
        if (args.key === 'Enter' && notPrevented) {
          const tag = tagName(target);
          if (['a', 'button', 'summary'].includes(tag)) {
            target.click?.();
            return { ok: true, text: `已按下 Enter 並啟動「${descriptor.name || tag}」` };
          }
          if (tag === 'input' && target.form?.requestSubmit) {
            target.form.requestSubmit();
            return { ok: true, text: '已按下 Enter 並送出表單' };
          }
        }
        return { ok: true, text: `已送出 ${args.key} 按鍵事件；模擬按鍵不一定會觸發網站反應，請重新取得快照確認結果` };
      }
      if (command === 'scroll') {
        if (!Number.isFinite(args.pixels)) throw new Error('捲動距離必須是數字');
        windowRef.scrollBy({ top: args.pixels, left: 0, behavior: 'auto' });
        return { ok: true, text: `已捲動 ${args.pixels} 像素` };
      }
      if (command === 'capture_context') return captureContext(args.kind);
      return { ok: false, error: `不支援的頁面指令：${command}` };
    } catch (error) {
      return { ok: false, error: error?.message || '頁面操作失敗' };
    }
  }

  return { handle, snapshot, invalidateRefs };
}

function installContentListener() {
  if (!globalThis.chrome?.runtime?.onMessage || !globalThis.document || globalThis.__cuemeshContentController) return;
  const controller = createContentController();
  // content script 在 isolated world 執行；頁面無法讀取這個控制器或直接送出批准結果。
  globalThis.__cuemeshContentController = controller;
  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.channel !== CONTENT_CHANNEL) return undefined;
    Promise.resolve(controller.handle(message))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || '頁面控制程式失敗' }));
    return true;
  });
}

installContentListener();
