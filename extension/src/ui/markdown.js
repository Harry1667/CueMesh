// 安全 Markdown：模型與網頁產生的文字一律不可信。
// 做法不是「先產生 HTML 再消毒」，而是解析成自己的節點樹，再用 createElement／createTextNode 建立 DOM。
// 原始 HTML 永遠只會變成文字節點，因此 <script>、事件屬性都沒有機會被瀏覽器解析。

const MAX_INPUT = 200_000; // 避免超長輸出卡住面板
const MAX_DEPTH = 8; // 巢狀引用、清單、行內樣式的層數上限，避免惡意輸入造成過深遞迴
const MAX_URL = 2048;
const MAX_BRACKET_SCAN = 2000;

// 第二道防線：渲染時只接受這些標籤與屬性，就算解析器將來出錯也不會輸出其他東西
const ALLOWED_TAGS = new Set([
  'p', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'hr', 'br', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div',
]);
const ALLOWED_ATTRS = {
  a: new Set(['href', 'title', 'target', 'rel']),
  div: new Set(['class', 'tabindex', 'role', 'aria-label']),
  th: new Set(['class']),
  td: new Set(['class']),
};

// 只允許絕對的 http、https、mailto 網址。
// 相對網址也拒絕：放在擴充功能頁面裡會指向 chrome-extension:// 自己的資源。
export function safeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
  // https://google.com@evil.com 看起來像 google，實際去 evil.com，常見於釣魚
  if (url.username || url.password) return null;
  return url.href;
}

const text = (value) => ({ type: 'text', value });
const node = (tag, children = [], attrs = {}) => ({ type: 'element', tag, attrs, children });

// ---------- 行內語法 ----------

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;
// 網址遇到空白、引號、角括號與全形標點就結束，中文句子裡的網址才不會黏到後面的字
const BARE_URL = /^https?:\/\/[^\s<>"'，。；：！？、（）「」『』【】《》]+/i;
const TRAILING_PUNCT = /[.,;:!?)\]}*_~]+$/;

function parseLinkTarget(s, open) {
  // s[open] 是 '('。允許網址內有成對括號，例如維基百科連結
  let i = open + 1;
  while (s[i] === ' ') i += 1;
  const start = i;
  let parens = 0;
  while (i < s.length && i - start <= MAX_URL) {
    const c = s[i];
    if (c === '\n' || c === ' ' || c === '\t') break;
    if (c === '(') parens += 1;
    if (c === ')') {
      if (parens === 0) break;
      parens -= 1;
    }
    i += 1;
  }
  const url = s.slice(start, i);
  while (s[i] === ' ') i += 1;
  let title = null;
  if (s[i] === '"') {
    const end = s.indexOf('"', i + 1);
    if (end === -1 || end - i > 300) return null;
    title = s.slice(i + 1, end);
    i = end + 1;
    while (s[i] === ' ') i += 1;
  }
  if (s[i] !== ')') return null;
  return { url, title, end: i + 1 };
}

function findClosingBracket(s, open) {
  let level = 0;
  const limit = Math.min(s.length, open + MAX_BRACKET_SCAN);
  for (let i = open; i < limit; i += 1) {
    const c = s[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '[') {
      level += 1;
    } else if (c === ']') {
      level -= 1;
      if (level === 0) return i;
    }
  }
  return -1;
}

function linkNode(href, title, children) {
  const attrs = { href, target: '_blank', rel: 'noopener noreferrer nofollow' };
  if (title) attrs.title = title;
  return node('a', children, attrs);
}

function isWordChar(c) {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

export function parseInline(s, depth = 0, inLink = false) {
  if (depth > MAX_DEPTH) return [text(s)];
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(text(buf));
    buf = '';
  };
  // 記住「後面已經找不到結尾」的符號，避免 ****…… 這類輸入變成平方時間
  const noCloser = new Set();
  const hasLinkEnd = s.includes('](');

  const tryDelim = (i, delim, tag) => {
    if (noCloser.has(delim)) return null;
    const close = s.indexOf(delim, i + delim.length);
    if (close === -1) {
      noCloser.add(delim);
      return null;
    }
    if (close === i + delim.length) return null;
    const inner = s.slice(i + delim.length, close);
    if (/^\s|\s$/.test(inner)) return null;
    return { element: node(tag, parseInline(inner, depth + 1, inLink)), end: close + delim.length };
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      out.push(node('br'));
      i += 1;
      continue;
    }
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n += 1;
      const fence = '`'.repeat(n);
      const close = noCloser.has(fence) ? -1 : s.indexOf(fence, i + n);
      if (close === -1) {
        noCloser.add(fence);
        buf += fence;
        i += n;
        continue;
      }
      flush();
      out.push(node('code', [text(s.slice(i + n, close))]));
      i = close + n;
      continue;
    }
    // 圖片不自動載入：提示注入可以用圖片網址把資料帶給外部伺服器（使用者不用點就會送出），所以只給連結
    if (c === '!' && s[i + 1] === '[' && hasLinkEnd) {
      const close = findClosingBracket(s, i + 1);
      if (close !== -1 && s[close + 1] === '(') {
        const target = parseLinkTarget(s, close + 1);
        if (target) {
          const href = safeUrl(target.url);
          const alt = s.slice(i + 2, close);
          if (href && !inLink) {
            flush();
            out.push(linkNode(href, target.title, [text(`圖片：${alt || href}`)]));
          } else {
            buf += s.slice(i, target.end);
          }
          i = target.end;
          continue;
        }
      }
    }
    if (c === '[' && hasLinkEnd) {
      const close = findClosingBracket(s, i);
      if (close !== -1 && s[close + 1] === '(') {
        const target = parseLinkTarget(s, close + 1);
        if (target) {
          const href = safeUrl(target.url);
          if (href && !inLink) {
            flush();
            out.push(linkNode(href, target.title, parseInline(s.slice(i + 1, close), depth + 1, true)));
          } else {
            // 不安全的連結保留原文，讓使用者看得到模型寫了什麼，但點不了
            buf += s.slice(i, target.end);
          }
          i = target.end;
          continue;
        }
      }
    }
    if (c === '<' && /^<https?:\/\//i.test(s.slice(i, i + 10))) {
      const close = s.indexOf('>', i);
      if (close !== -1 && close - i <= MAX_URL) {
        const href = safeUrl(s.slice(i + 1, close));
        if (href && !inLink) {
          flush();
          out.push(linkNode(href, null, [text(s.slice(i + 1, close))]));
          i = close + 1;
          continue;
        }
      }
    }
    if ((c === 'h' || c === 'H') && !inLink && !isWordChar(s[i - 1]) && /^https?:/i.test(s.slice(i, i + 6))) {
      const match = BARE_URL.exec(s.slice(i, i + MAX_URL));
      if (match) {
        const raw = match[0].replace(TRAILING_PUNCT, '');
        const href = safeUrl(raw);
        if (href) {
          flush();
          out.push(linkNode(href, null, [text(raw)]));
          i += raw.length;
          continue;
        }
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      const double = s[i + 1] === c;
      // 底線只在字詞邊界生效，snake_case_name 才不會被誤判成斜體
      const boundaryOk = c !== '_' || !isWordChar(s[i - 1]);
      let hit = null;
      if (double && boundaryOk) hit = tryDelim(i, c + c, c === '~' ? 'del' : 'strong');
      if (!hit && !double && c !== '~' && boundaryOk) hit = tryDelim(i, c, 'em');
      if (hit) {
        flush();
        out.push(hit.element);
        i = hit.end;
        continue;
      }
    }
    buf += c;
    i += 1;
  }
  flush();
  return out;
}

// ---------- 區塊語法 ----------

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
// 區塊標題降階：面板本身已用 h1、h2，模型輸出不應打亂頁面標題層級
const HEADING_TAG = { 1: 'h3', 2: 'h4', 3: 'h5', 4: 'h6', 5: 'h6', 6: 'h6' };

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < row.length; i += 1) {
    const c = row[i];
    if (c === '\\' && row[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (c === '`') {
      inCode = !inCode;
      cell += c;
    } else if (c === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableStart(lines, i) {
  return i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('-') && TABLE_DELIM.test(lines[i + 1]);
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || isTableStart(lines, i);
}

function parseTable(lines, start) {
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'align-center';
    if (right) return 'align-right';
    return null;
  });
  const cellAttrs = (col) => (aligns[col] ? { class: aligns[col] } : {});
  const headRow = node('tr', header.map((c, col) => node('th', parseInline(c), cellAttrs(col))));
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    const cells = splitRow(lines[i]);
    rows.push(node('tr', header.map((_, col) => node('td', parseInline(cells[col] ?? ''), cellAttrs(col)))));
    i += 1;
  }
  const table = node('table', [node('thead', [headRow]), node('tbody', rows)]);
  // 寬表格在 400px 面板要能水平捲動；tabindex 讓鍵盤使用者也捲得動
  const wrap = node('div', [table], { class: 'md-table', tabindex: '0', role: 'region', 'aria-label': '表格內容，可水平捲動' });
  return { block: wrap, next: i };
}

function parseList(lines, start, depth) {
  const first = LIST_ITEM.exec(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i]);
    if (!match || match[1].length < indent || /\d/.test(match[2]) !== ordered) break;
    if (match[1].length > indent) break;
    const body = [match[3]];
    i += 1;
    // 收集這個項目的延續行與巢狀內容
    const nested = [];
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const next = lines[i + 1];
        const nextItem = next !== undefined && LIST_ITEM.exec(next);
        if (nextItem && nextItem[1].length > indent) {
          i += 1;
          continue;
        }
        break;
      }
      const item = LIST_ITEM.exec(line);
      if (item && item[1].length <= indent) break;
      if (item) {
        nested.push(line);
      } else if (nested.length) {
        nested.push(line);
      } else if (startsBlock(lines, i)) {
        break;
      } else {
        body.push(line.trim());
      }
      i += 1;
    }
    const children = parseInline(body.join('\n'));
    if (nested.length && depth < MAX_DEPTH) {
      children.push(...parseBlocks(nested, depth + 1));
    } else if (nested.length) {
      children.push(text(nested.join('\n')));
    }
    items.push(node('li', children));
    // 項目之間的空行不要中斷清單
    while (i < lines.length && !lines[i].trim()) {
      const next = lines[i + 1];
      const nextItem = next !== undefined && LIST_ITEM.exec(next);
      if (nextItem && nextItem[1].length === indent) i += 1;
      else break;
    }
  }
  return { block: node(ordered ? 'ol' : 'ul', items), next: i };
}

function parseBlocks(lines, depth) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length) {
        const close = lines[i].trim();
        if (close.startsWith(marker) && /^[`~]+$/.test(close)) break;
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳過結尾圍欄；沒有結尾時就是檔案結束
      blocks.push(node('pre', [node('code', [text(body.join('\n'))])]));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(node(HEADING_TAG[heading[1].length], parseInline(heading[2])));
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push(node('hr'));
      i += 1;
      continue;
    }

    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const inner = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i]);
        if (!match) break;
        inner.push(match[1]);
        i += 1;
      }
      blocks.push(node('blockquote', parseBlocks(inner, depth + 1)));
      continue;
    }

    if (isTableStart(lines, i)) {
      const { block, next } = parseTable(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (LIST_ITEM.test(line) && depth < MAX_DEPTH) {
      const { block, next } = parseList(lines, i, depth);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push(node('p', parseInline(para.join('\n'))));
  }
  return blocks;
}

export function parseMarkdown(input) {
  const source = typeof input === 'string' ? input : String(input ?? '');
  const truncated = source.length > MAX_INPUT;
  const body = truncated ? source.slice(0, MAX_INPUT) : source;
  const blocks = parseBlocks(body.replace(/\r\n?/g, '\n').split('\n'), 0);
  if (truncated) blocks.push(node('p', [node('em', [text('（內容過長，以上只顯示前段；完整內容請看成果檔案。）')])]));
  return blocks;
}

// ---------- 渲染 ----------

function renderNode(n, doc) {
  if (n.type === 'text') return doc.createTextNode(n.value);
  if (!ALLOWED_TAGS.has(n.tag)) return doc.createTextNode(`<${n.tag}>`);
  const element = doc.createElement(n.tag);
  const allowed = ALLOWED_ATTRS[n.tag];
  for (const [name, value] of Object.entries(n.attrs)) {
    if (!allowed?.has(name)) continue;
    if (name === 'href' && !safeUrl(value)) continue;
    element.setAttribute(name, value);
  }
  for (const child of n.children) element.appendChild(renderNode(child, doc));
  return element;
}

export function renderMarkdown(input, doc = document) {
  const fragment = doc.createDocumentFragment();
  for (const block of parseMarkdown(input)) fragment.appendChild(renderNode(block, doc));
  return fragment;
}
