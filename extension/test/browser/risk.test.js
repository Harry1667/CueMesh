import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalRequired,
  assessActionRisk,
  hasHighRiskWords,
  isSensitiveField,
  navigationRisk,
  validateNavigationUrl,
} from '../../src/browser/risk.js';

test('高風險字詞同時辨識中英文與零寬字元繞過', () => {
  assert.equal(hasHighRiskWords('確認付款'), true);
  assert.equal(hasHighRiskWords('确认购买'), true);
  assert.equal(hasHighRiskWords('S\u200bu\u200bb\u200bm\u200bi\u200bt order'), true);
  assert.equal(hasHighRiskWords('儲存草稿'), false);
});

test('密碼與付款欄位以實際屬性判斷，不能用隱藏或不一致文案繞過', () => {
  assert.equal(isSensitiveField({ type: 'password', ariaLabel: '一般備註' }), true);
  assert.equal(isSensitiveField({ hidden: true, type: 'text', fieldName: 'card_number', ariaLabel: '優惠碼' }), true);
  assert.equal(isSensitiveField({ type: 'text', autocomplete: 'cc-number', name: 'memo' }), true);
  assert.equal(isSensitiveField({ type: 'text', fieldName: 'note', ariaLabel: '一般備註' }), false);
});

test('可見文字和 aria-label 不一致時，任一高風險語意都要求批准', () => {
  const assessment = assessActionRisk({
    tool: 'browser_click',
    element: { tag: 'button', name: '取消', visibleText: '取消', ariaLabel: 'Confirm purchase' },
    currentUrl: 'https://shop.example/cart',
  });
  assert.equal(assessment.risk, 'high');
  assert.match(assessment.reason, /高風險/);
});

test('表單送出、Enter、跨來源與帶查詢參數導覽都是高風險', () => {
  assert.equal(assessActionRisk({
    tool: 'browser_click', element: { tag: 'button', type: 'submit', form: true }, currentUrl: 'https://a.example/form',
  }).risk, 'high');
  assert.equal(assessActionRisk({ tool: 'browser_press_key', args: { key: 'Enter' } }).risk, 'high');
  assert.equal(navigationRisk('https://b.example/path', 'https://a.example/path').risk, 'high');
  assert.equal(navigationRisk('https://a.example/path?next=pay', 'https://a.example/old').risk, 'high');
  assert.equal(navigationRisk('https://a.example/path', 'https://a.example/old').risk, 'act');
});

test('付款欄位直接拒絕而不是要求批准', () => {
  const assessment = assessActionRisk({
    tool: 'browser_type',
    element: { tag: 'input', type: 'text', fieldName: 'cvv', ariaLabel: '備註' },
  });
  assert.equal(assessment.denied, true);
  assert.match(assessment.reason, /親自輸入/);
});

test('僅允許 http 與 https 導覽，批准模式符合規格', () => {
  assert.equal(validateNavigationUrl('javascript:alert(1)').ok, false);
  assert.equal(validateNavigationUrl('data:text/html,x').ok, false);
  assert.equal(validateNavigationUrl('https://example.com').ok, true);
  assert.equal(approvalRequired('high', 'risky'), true);
  assert.equal(approvalRequired('act', 'always'), true);
  assert.equal(approvalRequired('act', 'risky'), false);
});

test('補強：繁體「發送」「轉帳」為高風險，明文顯示的密碼欄仍被擋，沒有焦點元素不會當掉', () => {
  for (const name of ['發送訊息', '立即轉帳', '訂閱方案', 'Transfer funds']) {
    assert.equal(assessActionRisk({ tool: 'browser_click', element: { tag: 'div', name }, currentUrl: 'https://a.test/' }).risk, 'high', name);
  }
  assert.equal(assessActionRisk({ tool: 'browser_type', args: { ref: 'e1', text: 'x' }, element: { tag: 'input', type: 'text', fieldName: 'user_password' } }).denied, true);
  assert.equal(assessActionRisk({ tool: 'browser_press_key', args: { key: 'a' }, element: null, currentUrl: 'https://a.test/' }).risk, 'act');
});
