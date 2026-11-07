// 瀏覽器動作的風險判定必須是純函式，不能相信頁面提供的單一文案。

const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;

const DANGEROUS_ENGLISH = [
  'submit', 'send', 'payment', 'pay', 'purchase', 'buy', 'checkout', 'order',
  'delete', 'remove', 'destroy', 'publish', 'post', 'confirm', 'proceed', 'authorize',
  'transfer', 'subscribe', 'withdraw',
];

const DANGEROUS_CHINESE = [
  '送出', '提交', '遞交', '付款', '付費', '支付', '購買', '下單', '結帳',
  '刪除', '移除', '清除', '發布', '發佈', '刊登', '傳送', '發送', '寄送', '確認', '確定',
  '訂購', '訂閱', '儲值', '轉帳', '匯款', '提款', '订购', '订阅', '转账', '汇款',
  '递交', '付费', '购买', '下单', '结账', '删除', '发布', '传送', '发送', '确认', '确定',
];

// 密碼欄切換成明文顯示時 type 會變成 text，所以也要比對欄位名稱
const CARD_OR_SECRET_FIELD = /(?:password|passwd|passcode|pwd|credit|debit|card|ccnum|ccnumber|cvv|cvc|securitycode|cardnumber|密碼|密码|信用卡|銀行卡|银行卡|卡號|卡号|驗證碼|验证码)/i;

export function normalizeRiskText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTERS, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactRiskText(value) {
  return normalizeRiskText(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function valuesForRisk(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return [
    value.name,
    value.text,
    value.visibleText,
    value.ariaLabel,
    value.ariaLabelledby,
    value.label,
    value.placeholder,
    value.title,
    value.value,
    value.type,
    value.fieldName,
    value.id,
    value.autocomplete,
    value.href,
    value.formAction,
  ].filter((item) => typeof item === 'string');
}

export function hasHighRiskWords(value) {
  return valuesForRisk(value).some((item) => {
    const compact = compactRiskText(item);
    return DANGEROUS_ENGLISH.some((word) => compact.includes(word))
      || DANGEROUS_CHINESE.some((word) => compact.includes(word));
  });
}

export function isSensitiveField(rawElement) {
  // 沒有焦點元素時 inspect_focused 會回 null，預設參數接不住 null
  const element = rawElement ?? {};
  const type = normalizeRiskText(element.type);
  const autocomplete = normalizeRiskText(element.autocomplete);
  if (type === 'password' || autocomplete.startsWith('cc-')) return true;

  // 要同時檢查實際欄位屬性及可及性文案。可見文字可以被偽造，不能作為唯一依據。
  const identity = [
    element.fieldName,
    element.name,
    element.id,
    element.autocomplete,
    element.ariaLabel,
    element.ariaLabelledby,
    element.label,
    element.placeholder,
  ].join(' ');
  return CARD_OR_SECRET_FIELD.test(compactRiskText(identity));
}

export function validateNavigationUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, error: '只允許導覽至 http 或 https 網址' };
    }
    return { ok: true, url: url.href };
  } catch {
    return { ok: false, error: '網址格式無效' };
  }
}

export function restrictedPageReason(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'devtools:' || url.protocol === 'edge:') {
      return '這是瀏覽器受保護頁面，CueMesh 無法操作';
    }
    if (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) {
      return 'Chrome 線上應用程式商店是受保護頁面，CueMesh 無法操作';
    }
    if (url.hostname === 'chromewebstore.google.com') {
      return 'Chrome 線上應用程式商店是受保護頁面，CueMesh 無法操作';
    }
  } catch {
    return '目前分頁網址無效，CueMesh 無法操作';
  }
  return null;
}

export function navigationRisk(destination, currentUrl) {
  const checked = validateNavigationUrl(destination);
  if (!checked.ok) return { denied: true, risk: 'high', reason: checked.error };

  const target = new URL(checked.url);
  const reasons = [];
  try {
    const current = new URL(String(currentUrl));
    if (current.origin !== target.origin) reasons.push('即將導覽至不同來源的網站');
  } catch {
    reasons.push('無法確認目前網站來源');
  }
  if (target.search) reasons.push('網址包含查詢參數');
  return { risk: reasons.length ? 'high' : 'act', reason: reasons.join('；') || '導覽至新網址', url: checked.url };
}

function isFormSubmission(rawElement) {
  const element = rawElement ?? {};
  if (element.formSubmit === true) return true;
  const tag = normalizeRiskText(element.tag);
  const type = normalizeRiskText(element.type);
  return (tag === 'button' && (!type || type === 'submit') && Boolean(element.form))
    || (tag === 'input' && ['submit', 'image'].includes(type));
}

export function assessActionRisk({ tool, args = {}, element, currentUrl } = {}) {
  if (['browser_type', 'browser_press_key'].includes(tool) && isSensitiveField(element)) {
    return { denied: true, risk: 'high', reason: '密碼與付款欄位必須由使用者親自輸入' };
  }

  if (tool === 'browser_navigate' || tool === 'browser_new_tab') {
    return navigationRisk(args.url, currentUrl);
  }

  const reasons = [];
  if (tool === 'browser_press_key' && normalizeRiskText(args.key) === 'enter') reasons.push('按 Enter 可能送出表單或確認操作');

  if (tool === 'browser_click') {
    if (isFormSubmission(element)) reasons.push('這是表單送出控制項');
    if (hasHighRiskWords(element)) reasons.push('控制項文案或語意涉及高風險動作');
    const destination = element?.href || element?.formAction;
    if (destination) {
      const navigation = navigationRisk(destination, currentUrl);
      if (navigation.denied) return navigation;
      if (navigation.risk === 'high') reasons.push(navigation.reason);
    }
  }

  return { risk: reasons.length ? 'high' : 'act', reason: reasons.join('；') || '一般頁面動作' };
}

export function approvalRequired(risk, mode) {
  return risk === 'high' || (risk === 'act' && mode !== 'risky');
}
