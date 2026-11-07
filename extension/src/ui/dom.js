// 小型 DOM 工具。字串子節點一律變成文字節點，也刻意不提供任何塞 HTML 的路徑。
import { safeUrl } from './markdown.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FORBIDDEN_PROPS = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'style']);
const DOM_PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'open', 'required', 'readOnly', 'multiple']);

export function h(tag, props, ...kids) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) {
      // aria-* 的 false 有意義（例如 aria-expanded="false"），要寫出來
      if (value === false && key.startsWith('aria-')) element.setAttribute(key, 'false');
      continue;
    }
    if (FORBIDDEN_PROPS.has(key)) throw new Error(`h() 不接受 ${key}`);
    if (/^on[A-Z]/.test(key)) {
      if (typeof value !== 'function') throw new Error(`${key} 必須是函式`);
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (/^on/i.test(key)) {
      throw new Error(`h() 不接受字串事件屬性 ${key}`);
    } else if (key === 'class') {
      element.setAttribute('class', value);
    } else if (key === 'href') {
      // 不安全的網址直接不設定，元素還是會顯示文字，只是點不了
      const href = safeUrl(value);
      if (href) element.setAttribute('href', href);
    } else if (DOM_PROPS.has(key)) {
      element[key] = value;
    } else {
      element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(element, kids);
  return element;
}

function append(parent, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) append(parent, kid);
    else if (typeof kid === 'string' || typeof kid === 'number') parent.appendChild(document.createTextNode(String(kid)));
    else parent.appendChild(kid);
  }
}

// 在重建內容時保留鍵盤焦點：可聚焦元素用 data-fk 標記身分，鍵盤使用者才不會每次更新都被踢回頁首
export function replaceKeepingFocus(container, children) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.getAttribute?.('data-fk') : null;
  const list = children.flat(Infinity).filter(Boolean);
  container.replaceChildren(...list);
  if (key) {
    const next = [...container.querySelectorAll('[data-fk]')].find((el) => el.getAttribute('data-fk') === key);
    if (next && !next.disabled) next.focus();
  }
}

// Lucide 風格線條圖示
const ICONS = {
  selection: 'M17 22h-1a4 4 0 01-4-4V6a4 4 0 014-4h1M7 22h1a4 4 0 004-4M7 2h1a4 4 0 014 4',
  region: 'M5 3a2 2 0 00-2 2M9 3h1M14 3h1M19 3a2 2 0 012 2M21 9v1M21 14v1M21 19a2 2 0 01-2 2M15 21h-1M10 21H9M5 21a2 2 0 01-2-2M3 15v-1M3 10V9',
  element: 'M4 4l7.07 17 2.51-7.39L21 11.07 4 4zM14 14l6 6',
  page: 'M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7l-5-5zM14 2v6h6M16 13H8M16 17H8',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6L6 18M6 6l12 12',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  back: 'M19 12H5M12 19l-7-7 7-7',
  chevron: 'M6 9l6 6 6-6',
  check: 'M20 6L9 17l-5-5',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z',
  copy: 'M9 9h11a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2V9zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  link: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  alert: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.appendChild(path);
  return svg;
}

// 正式 Logo：public/icons 的兩個 SVG 原樣使用。深色字版給淺色介面，淺色字版給深色介面，由 CSS 依主題顯示其中一張
export function sealMark(assetBase = 'icons/', size = 22) {
  const image = (file, cls) => h('img', { class: `logo ${cls}`, src: `${assetBase}${file}`, width: size, height: size, alt: '' });
  return [image('cuemesh-logo-transparent.svg', 'logo--on-light'), image('cuemesh-logo-transparent-light.svg', 'logo--on-dark')];
}

// 小選單：鍵盤可操作（方向鍵移動、Esc 關閉並把焦點還給按鈕），點外面關閉
export function createMenu({ id, label, leading = null, align = 'start', buttonId, renderItems }) {
  const text = h('span', { class: 'ctl__text' });
  const button = h('button', {
    type: 'button',
    id: buttonId,
    class: 'ctl',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-controls': id,
    onClick: () => (panel.hidden ? open() : close()),
    onKeydown: (e) => {
      if (e.key === 'ArrowDown' && panel.hidden) {
        e.preventDefault();
        open();
      }
    },
  }, leading, text, icon('chevron', 14));
  const items = () => [...panel.querySelectorAll('[role^="menuitem"]:not([disabled])')];
  const panel = h('div', {
    class: `menu${align === 'end' ? ' menu--end' : ''}`,
    id,
    role: 'menu',
    'aria-label': label,
    hidden: true,
    onKeydown: (e) => {
      const list = items();
      const index = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        list[(index + step + list.length) % list.length]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') {
        close();
      }
    },
  });
  const wrap = h('div', { class: 'ctl-wrap' }, button, panel);
  const onOutside = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  function open() {
    panel.replaceChildren(...renderItems(close).flat(Infinity).filter(Boolean));
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    (panel.querySelector('[aria-checked="true"]:not([disabled])') ?? items()[0])?.focus();
  }
  function close(refocus = false) {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
    if (refocus) button.focus();
  }
  return {
    el: wrap,
    button,
    close,
    setText(value) {
      text.textContent = value;
      button.setAttribute('aria-label', `${label}：${value}`);
    },
  };
}

export function menuItem({ label, hint, checked, disabled, onSelect, leading, data = {} }) {
  const isRadio = checked !== undefined;
  return h('button', {
    type: 'button',
    class: 'menu__item',
    role: isRadio ? 'menuitemradio' : 'menuitem',
    'aria-checked': isRadio ? String(Boolean(checked)) : undefined,
    disabled: Boolean(disabled),
    onClick: onSelect,
    ...data,
  },
  leading,
  h('span', { class: 'menu__body' }, h('span', { class: 'menu__label' }, label), hint && h('span', { class: 'menu__hint' }, hint)),
  isRadio && checked ? icon('check', 14) : null);
}

// 不用瀏覽器 confirm（會卡住畫面）：按一次變成「確定？」，幾秒內再按才執行
export function confirmButton({ label, confirmLabel, onConfirm, className = 'btn btn--quiet', fk, ariaLabel }) {
  let armed = false;
  let timer = null;
  const button = h('button', {
    type: 'button',
    class: className,
    'data-fk': fk,
    'aria-label': ariaLabel,
    onClick: async () => {
      if (!armed) {
        armed = true;
        button.textContent = confirmLabel;
        button.classList.add('is-armed');
        timer = setTimeout(() => {
          armed = false;
          button.textContent = label;
          button.classList.remove('is-armed');
        }, 4000);
        return;
      }
      clearTimeout(timer);
      armed = false;
      button.textContent = label;
      button.classList.remove('is-armed');
      await onConfirm();
    },
  }, label);
  return button;
}
