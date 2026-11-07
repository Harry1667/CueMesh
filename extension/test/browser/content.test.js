import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeElement, elementFingerprint, normalizePageText } from '../../src/content/index.js';

function fakeElement({ attributes = {}, text = '按鈕文字', ...rest } = {}) {
  return {
    tagName: 'BUTTON',
    isConnected: true,
    textContent: text,
    innerText: text,
    type: 'button',
    disabled: false,
    readOnly: false,
    hidden: false,
    getAttribute(name) { return attributes[name] ?? ''; },
    getBoundingClientRect() { return { width: 100, height: 20 }; },
    closest() { return null; },
    ...rest,
  };
}

test('頁面文字正規化會去除多餘空白並保留長度上限', () => {
  assert.equal(normalizePageText('  一\n\t二  '), '一 二');
  assert.equal(normalizePageText('abcdef', 3), 'abc');
});

test('假 DOM 的元素描述同時保留可見與 aria 語意，供風險模組保守判斷', () => {
  const element = fakeElement({ attributes: { 'aria-label': 'Confirm purchase', name: 'safe_name' }, text: '取消' });
  const documentRef = { querySelectorAll: () => [], getElementById: () => null };
  const windowRef = { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  const descriptor = describeElement(element, { ref: 'e1', documentRef, windowRef });
  assert.equal(descriptor.name, 'Confirm purchase');
  assert.equal(descriptor.text, '取消');
  assert.equal(descriptor.ariaLabel, 'Confirm purchase');
  assert.match(elementFingerprint(descriptor), /Confirm purchase/);
});

test('假 DOM 的付款欄位不會依顯示名稱被誤判為一般文字欄位', () => {
  const element = fakeElement({
    tagName: 'INPUT',
    type: 'text',
    text: '',
    attributes: { name: 'card_number', 'aria-label': '一般備註', autocomplete: 'off' },
  });
  const documentRef = { querySelectorAll: () => [], getElementById: () => null };
  const windowRef = { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  assert.equal(describeElement(element, { documentRef, windowRef }).sensitive, true);
});
