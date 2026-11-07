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

const ICONS = {
  selection: 'M5 4h3M5 20h3M6.5 4v16M11 8h8M11 12h8M11 16h5',
  region: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 12h6M12 9v6',
  element: 'M5 4l5.5 15 2.3-6.2L19 10.5 5 4zM14 14l5 5',
  page: 'M6 3h9l4 4v14H6V3zM15 3v4h4M9 12h7M9 16h7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  copy: 'M9 9h11v11H9V9zM5 15H4V4h11v1',
  link: 'M14 5h5v5M19 5l-8 8M17 14v5H5V7h5',
  key: 'M14.5 9.5a4.5 4.5 0 11-1.3-3.2 4.5 4.5 0 011.3 3.2zM6 13l-3 3v4h4v-2h2v-2h2l1-1',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.appendChild(path);
  return svg;
}

// 品牌印章：朱紅方印裡的三個節點，代表一句提示接上多家 AI
export function sealMark(size = 26) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'seal');
  const add = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  };
  add('rect', { x: '1', y: '1', width: '30', height: '30', rx: '3', class: 'seal__bg' });
  add('path', { d: 'M9 10L16 22L23 10M9 10H23', class: 'seal__line', fill: 'none', 'stroke-width': '2' });
  for (const [cx, cy] of [[9, 10], [23, 10], [16, 22]]) add('circle', { cx: String(cx), cy: String(cy), r: '3.2', class: 'seal__dot' });
  return svg;
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
