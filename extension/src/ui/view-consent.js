// 派工同意視窗：別人（或你的另一台裝置）要在這個瀏覽器執行任務前，一定要清楚告知。
// 派工內容來自其他人，是不可信資料：只當文字顯示，並拿掉會造成視覺欺騙的字元。
import { h } from './dom.js';
import { consentBudget, formatUsd, isCrossAccount, stripControls } from './logic.js';

// 和批准對話框相同：新請求出現時先鎖住接受鍵，避免連點誤接
const ARM_DELAY_MS = 800;

export function createConsentDialog(queue, { announce, getLocalMaxCost, getProjectName }) {
  const band = h('p', { class: 'approval__band' });
  const title = h('h2', { class: 'approval__title consent__title', id: 'consent-title' });
  const rows = h('dl', { class: 'approval__rows', id: 'consent-rows' });
  const warning = h('div', { class: 'warning-box consent__warning' });
  const reasonInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: '200',
    placeholder: '例如：現在不方便',
    'aria-label': '拒絕的原因（選填）',
  });
  const reasonRow = h('label', { class: 'approval__note' }, h('span', null, '拒絕的原因（選填，對方會看到）'), reasonInput);
  const waiting = h('p', { class: 'approval__waiting', hidden: true });

  const rejectBtn = h('button', { type: 'button', class: 'btn btn--ink consent__reject', onClick: () => decide(false) }, '拒絕');
  const acceptBtn = h('button', { type: 'button', class: 'btn consent__accept', onClick: () => decide(true) }, '接受');

  const dialog = h('dialog', {
    class: 'approval consent',
    'aria-labelledby': 'consent-title',
    'aria-describedby': 'consent-rows',
    onCancel: (e) => {
      // Esc 視為拒絕：最安全的預設
      e.preventDefault();
      decide(false);
    },
  },
  h('div', { class: 'approval__card' },
    band,
    title,
    rows,
    warning,
    reasonRow,
    waiting,
    h('div', { class: 'approval__actions' }, rejectBtn, acceptBtn),
    h('div', { class: 'approval__foot' }, h('p', { class: 'approval__hint' }, '按 Esc 等於拒絕。'))));

  let shown = null;
  let armTimer = null;

  function decide(accepted) {
    if (!shown) return;
    if (accepted && acceptBtn.disabled) return;
    const reason = reasonInput.value.trim();
    queue.respond(accepted, accepted ? undefined : reason);
  }

  const row = (label, value) => h('div', { class: 'approval__row' }, h('dt', null, label), h('dd', null, value));

  function paintWaiting(count) {
    waiting.hidden = count === 0;
    waiting.textContent = count ? `後面還有 ${count} 個派工等你決定` : '';
  }

  function paint(dispatch, waitingCount) {
    const cross = isCrossAccount(dispatch);
    const sender = stripControls(dispatch.senderName) || '不明的使用者';
    dialog.dataset.risk = cross ? 'high' : 'act';
    band.textContent = cross ? '其他帳號要使用你的瀏覽器' : '你的另一台裝置派工過來';
    title.textContent = cross
      ? `${sender} 想在你的瀏覽器執行任務`
      : '要在這台裝置執行這個任務嗎？';

    const budget = consentBudget(dispatch, getLocalMaxCost());
    const contextCount = Array.isArray(dispatch.context) ? dispatch.context.length : 0;
    const projectName = getProjectName(dispatch.projectId);
    const list = [
      row('發起者', h('span', null, h('strong', null, sender), cross ? '（其他帳號）' : '（你自己的帳號）')),
      row('要做什麼', h('div', { class: 'consent__goal', tabindex: '0', role: 'region', 'aria-label': '派工內容' }, stripControls(dispatch.goal) || '（沒有內容）')),
      projectName ? row('專案', stripControls(projectName)) : null,
      contextCount > 0 ? row('附帶資料', `${contextCount} 項對方提供的情境`) : null,
      row('費用', h('span', null,
        h('strong', { class: 'consent__budget' }, budget === null ? '沒有上限資訊' : `最多 ${formatUsd(budget)}`),
        h('span', { class: 'consent__payer' }, '由你的 API key 支付'))),
    ];
    rows.replaceChildren(...list.filter(Boolean));

    warning.replaceChildren(
      h('strong', null, '它能看到你登入中的網站'),
      h('p', null, cross
        ? '包括信箱、銀行、公司後台。對方的內容可能藏有惡意指令。這個任務的每個瀏覽器動作都會逐步問你，但你一接受，它就能讀取頁面內容。'
        : '包括信箱、銀行、公司後台。如果這不是你剛才發起的，代表帳號可能被盜，請拒絕並更改密碼。'),
    );
    acceptBtn.textContent = cross ? '仍要接受' : '接受';
    acceptBtn.classList.toggle('btn--danger-solid', cross);
    acceptBtn.classList.toggle('btn--go', !cross);
    paintWaiting(waitingCount);
  }

  const unsubscribe = queue.subscribe((request, waitingCount) => {
    if (!request) {
      shown = null;
      clearTimeout(armTimer);
      if (dialog.open) dialog.close();
      return;
    }
    if (shown && request.id === shown.id) {
      paintWaiting(waitingCount);
      return;
    }
    shown = request;
    reasonInput.value = '';
    paint(request, waitingCount);
    if (!dialog.open) dialog.showModal();
    rejectBtn.focus();
    clearTimeout(armTimer);
    acceptBtn.disabled = true;
    armTimer = setTimeout(() => {
      acceptBtn.disabled = false;
    }, ARM_DELAY_MS);
    announce(`${isCrossAccount(request) ? '其他帳號' : '你的另一台裝置'}要在這個瀏覽器執行任務，請決定是否接受`);
  });

  return {
    el: dialog,
    destroy() {
      unsubscribe();
      clearTimeout(armTimer);
    },
  };
}
