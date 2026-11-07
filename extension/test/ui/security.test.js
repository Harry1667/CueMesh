import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allElements, createFakeDocument } from './fake-dom.js';

const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'ui');
// dev.js 只用於本機預覽，不會打包進擴充功能，但一樣不該用這些寫法
const sources = readdirSync(uiDir)
  .filter((name) => /\.(js|mjs)$/.test(name))
  .map((name) => ({ name, code: readFileSync(join(uiDir, name), 'utf8') }));

// 去掉註解與字串，避免說明文字造成誤判
const stripCommentsAndStrings = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

describe('靜態掃描：UI 程式碼不可有塞 HTML 或執行字串的入口', () => {
  test('有掃到檔案', () => {
    assert.ok(sources.length >= 8, `只掃到 ${sources.length} 個檔案`);
    assert.ok(sources.some((s) => s.name === 'app.js'));
    assert.ok(sources.some((s) => s.name === 'view-run.js'));
  });

  const FORBIDDEN = [
    [/\.innerHTML\b/, 'innerHTML'],
    [/\.outerHTML\b/, 'outerHTML'],
    [/insertAdjacentHTML/, 'insertAdjacentHTML'],
    [/document\.write/, 'document.write'],
    [/\beval\s*\(/, 'eval'],
    [/new\s+Function\s*\(/, 'new Function'],
    [/DOMParser/, 'DOMParser'],
    [/createContextualFragment/, 'createContextualFragment'],
    [/localStorage\.setItem\([^)]*apiKey/i, '把 key 存進 localStorage'],
  ];

  for (const { name, code } of sources) {
    test(name, () => {
      const stripped = stripCommentsAndStrings(code);
      for (const [pattern, label] of FORBIDDEN) assert.ok(!pattern.test(stripped), `${name} 使用了 ${label}`);
    });
  }

  test('srcdoc 只出現在 sandbox iframe 的預覽裡', () => {
    const users = sources.filter((s) => /setAttribute\('srcdoc'/.test(s.code));
    assert.deepEqual(users.map((s) => s.name), ['view-run.js']);
    const code = users[0].code;
    // sandbox 必須在設定內容之前，而且不可給 allow-same-origin
    assert.ok(code.indexOf("setAttribute('sandbox', 'allow-scripts')") < code.indexOf("setAttribute('srcdoc'"));
    assert.ok(!/allow-same-origin/.test(stripCommentsAndStrings(code).replace(/allow-scripts/g, '')));
    assert.ok(!code.includes("'allow-scripts allow-same-origin'"));
  });

  test('localStorage 只存主題與目前專案，不存任何機密', () => {
    const app = sources.find((s) => s.name === 'app.js').code;
    const keys = [...app.matchAll(/(?<!function )writePref\((\w+)/g)].map((m) => m[1]);
    assert.ok(keys.length >= 2);
    assert.deepEqual([...new Set(keys)].sort(), ['PROJECT_KEY', 'THEME_KEY']);
    for (const { name, code } of sources) {
      // dev.js 不會打包，裡面的 localStorage 是放進沙盒 iframe、用來驗證隔離的探測碼
      if (name === 'app.js' || name === 'dev.js') continue;
      assert.ok(!/localStorage\s*\.\s*setItem/.test(code), `${name} 不該直接寫 localStorage`);
    }
  });

  test('API key 不會被寫進 console', () => {
    for (const { name, code } of sources) {
      assert.ok(!/console\.\w+\([^)]*(apiKey|input\.value)/.test(code), `${name} 可能把 key 寫進 console`);
    }
  });

  test('沙盒頁面只接受父頁面傳來的訊息', () => {
    const html = readFileSync(join(uiDir, 'preview-sandbox.html'), 'utf8');
    assert.match(html, /event\.source !== window\.parent/);
  });
});

describe('h()：DOM 工具的安全行為', () => {
  let h;
  const originalDocument = globalThis.document;

  before(async () => {
    globalThis.document = createFakeDocument();
    ({ h } = await import('../../src/ui/dom.js'));
  });
  after(() => {
    globalThis.document = originalDocument;
  });

  test('字串子節點是文字節點，不解析 HTML', () => {
    const el = h('p', null, '<img src=x onerror=alert(1)>');
    assert.equal(allElements(el).filter((e) => e.tagName === 'img').length, 0);
    assert.equal(el.textContent, '<img src=x onerror=alert(1)>');
  });

  test('拒絕 innerHTML、srcdoc 等屬性', () => {
    for (const prop of ['innerHTML', 'outerHTML', 'srcdoc']) {
      assert.throws(() => h('div', { [prop]: '<b>x</b>' }), new RegExp(prop));
    }
  });

  test('拒絕字串形式的事件屬性', () => {
    assert.throws(() => h('div', { onclick: 'alert(1)' }), /事件屬性/);
    assert.throws(() => h('div', { onClick: 'alert(1)' }), /必須是函式/);
    assert.throws(() => h('div', { ONLOAD: 'alert(1)' }), /事件屬性/);
  });

  test('函式事件會綁定，不會變成屬性', () => {
    const fn = () => {};
    const el = h('button', { onClick: fn });
    assert.equal(el.listeners.click, fn);
    assert.equal(el.getAttribute('onClick'), null);
  });

  test('不安全的 href 不會被設定', () => {
    for (const href of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', '/relative', '//evil.com']) {
      assert.equal(h('a', { href }).getAttribute('href'), null, href);
    }
    assert.equal(h('a', { href: 'https://example.com/' }).getAttribute('href'), 'https://example.com/');
  });

  test('aria 的 false 要寫出來，其他 false 不寫', () => {
    const el = h('button', { 'aria-expanded': false, 'data-x': false });
    assert.equal(el.getAttribute('aria-expanded'), 'false');
    assert.equal(el.getAttribute('data-x'), null);
  });

  test('null、undefined、false 子節點會略過，0 會顯示', () => {
    const el = h('p', null, null, undefined, false, 0, ['甲', null, ['乙']]);
    assert.equal(el.textContent, '0甲乙');
  });
});
