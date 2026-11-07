// 批准對話框：一次顯示一個，其餘排隊。用原生 <dialog> 取得焦點鎖定與 Esc 處理。
// 目標元素與網址來自網頁，可能刻意偽裝，所以只當文字顯示，並先拿掉會造成視覺欺騙的字元。
import { h } from './dom.js';
import { describeArgs, describeElement, describeUrl, stripControls, toolLabel } from './logic.js';

// 新請求出現時先鎖住批准鍵一小段時間：上一個對話框剛關閉時，使用者的連點不該直接批准下一個
const ARM_DELAY_MS = 500;

export function createApprovalDialog(queue, { announce, onCancelRun }) {
  const band = h('p', { class: 'approval__band' });
  const title = h('h2', { class: 'approval__title', id: 'approval-title' });
  const rows = h('dl', { class: 'approval__rows' });
  const noteInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: '200',
    placeholder: '例如：不要送出，先讓我檢查',
    'aria-label': '拒絕時要告訴 agent 的話（選填）',
  });
  const noteRow = h('label', { class: 'approval__note' }, h('span', null, '告訴 agent 為什麼（選填）'), noteInput);
  const waiting = h('p', { class: 'approval__waiting', hidden: true });
  const hint = h('p', { class: 'approval__hint' }, '按 Esc 等於拒絕。');

  const rejectBtn = h('button', { type: 'button', class: 'btn btn--ink approval__reject', onClick: () => decide(false) }, '拒絕');
  const approveBtn = h('button', { type: 'button', class: 'btn approval__approve', onClick: () => decide(true) }, '批准');
  // 對話框是 modal，開著時按不到外面的取消鍵，這裡要留一個隨時能停止任務的出口
  const cancelRunBtn = h('button', {
    type: 'button',
    class: 'linkbtn approval__cancel',
    onClick: () => {
      if (shown?.runId) onCancelRun?.(shown.runId);
    },
  }, '取消整個任務');

  const dialog = h('dialog', {
    class: 'approval',
    'aria-labelledby': 'approval-title',
    'aria-describedby': 'approval-rows',
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
    noteRow,
    waiting,
    h('div', { class: 'approval__actions' }, rejectBtn, approveBtn),
    h('div', { class: 'approval__foot' }, hint, cancelRunBtn)));
  rows.id = 'approval-rows';

  let shown = null;
  let armTimer = null;

  function decide(approved) {
    if (!shown) return;
    if (approved && approveBtn.disabled) return;
    const note = noteInput.value.trim();
    queue.respond(approved, approved ? undefined : note);
  }

  const row = (label, value, opts = {}) => {
    if (value === null || value === undefined || value === '') return null;
    return h('div', { class: `approval__row${opts.emphasis ? ' approval__row--emphasis' : ''}` }, h('dt', null, label), h('dd', null, value));
  };

  function paint(request, waitingCount) {
    const high = request.risk === 'high';
    dialog.dataset.risk = high ? 'high' : 'act';
    band.textContent = high ? '高風險動作' : '需要你批准';
    title.textContent = toolLabel(request.tool);
    const url = describeUrl(request.url);
    const argsText = describeArgs(request.tool, request.args);
    const list = [
      row('動作內容', argsText ? stripControls(argsText) : null),
      row('目標元素', describeElement(request.element)),
      url && row('網址', url.host
        ? h('span', null, h('strong', { class: 'approval__host' }, url.host), h('span', { class: 'approval__url' }, url.full))
        : url.full),
      row('風險原因', request.reason ? stripControls(request.reason) : (high ? '這個動作可能無法復原。' : '這個動作會改變頁面。'), { emphasis: high }),
    ].filter(Boolean);
    rows.replaceChildren(...list);
    approveBtn.textContent = high ? '仍要批准' : '批准';
    approveBtn.classList.toggle('btn--danger-solid', high);
    approveBtn.classList.toggle('btn--go', !high);
    waiting.hidden = waitingCount === 0;
    waiting.textContent = waitingCount ? `後面還有 ${waitingCount} 個動作等你批准` : '';
  }

  function arm(high) {
    clearTimeout(armTimer);
    approveBtn.disabled = true;
    armTimer = setTimeout(() => {
      approveBtn.disabled = false;
      // 一般動作可以直接按 Enter 批准；高風險焦點留在拒絕上，要批准得多一個動作
      if (!high && shown) approveBtn.focus();
    }, ARM_DELAY_MS);
  }

  const unsubscribe = queue.subscribe((request, waitingCount) => {
    if (!request) {
      shown = null;
      clearTimeout(armTimer);
      if (dialog.open) dialog.close();
      return;
    }
    if (request === shown) {
      // 同一個請求，只是排隊數量變了；不重設輸入內容與焦點
      waiting.hidden = waitingCount === 0;
      waiting.textContent = waitingCount ? `後面還有 ${waitingCount} 個動作等你批准` : '';
      return;
    }
    shown = request;
    noteInput.value = '';
    paint(request, waitingCount);
    if (!dialog.open) dialog.showModal();
    rejectBtn.focus();
    arm(request.risk === 'high');
    announce(`${request.risk === 'high' ? '高風險動作' : '動作'}等你批准：${toolLabel(request.tool)}`);
  });

  return {
    el: dialog,
    destroy() {
      unsubscribe();
      clearTimeout(armTimer);
    },
  };
}
