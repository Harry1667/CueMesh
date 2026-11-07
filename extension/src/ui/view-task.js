// 任務頁：只留一個輸入區，其餘功能收進三個小選單。
import { createMenu, h, icon, menuItem } from './dom.js';
import {
  applyMention, CONTEXT_KINDS, connectedProviders, dispatchContext, dispatchTargets, filterMentions, findMentionQuery,
  hostOf, imageDataUrl, clip, targetLabel, deviceLabel,
} from './logic.js';

const MODES = [
  { id: 'auto', label: '自動', hint: '由 AI 拆解工作，分給最適合的 agent' },
  { id: 'council', label: 'AI 議會', hint: 'Claude 與 OpenAI 各自作答再比較，需要兩家的 key' },
  { id: 'workflow', label: '工作流', hint: '照你存好的固定步驟執行' },
];
const CONTEXT_ICONS = { selection: 'selection', region: 'region', element: 'element', page: 'page' };
const CONTEXT_LABELS = Object.fromEntries(CONTEXT_KINDS.map((c) => [c.kind, c.label]));
const EXAMPLES = ['摘要我正在看的這個頁面', '比較這三個產品的價格，整理成表格', '@coding 做一個可以互動的待辦清單網頁'];
const MAX_GOAL_HEIGHT = 240;

export function createTaskView({ S, actions, getBlocker, cloud }) {
  // ---------- 狀態提示 ----------
  const keyNotice = h('p', { class: 'notice', hidden: true },
    h('span', null, '還沒設定 API key。'),
    h('button', { type: 'button', class: 'linkbtn', onClick: () => actions.openSettings('keys') }, '前往設定'));

  const activeCancel = h('button', {
    type: 'button',
    class: 'btn btn--danger btn--small',
    onClick: () => S.activeRunId && actions.cancel(S.activeRunId),
  }, '取消任務');
  const activeBanner = h('div', { class: 'notice notice--live', hidden: true },
    h('span', { class: 'lamp', 'data-status': 'running', 'aria-hidden': 'true' }),
    h('span', { class: 'notice__text' }, '有任務正在執行'),
    h('button', { type: 'button', class: 'btn btn--small', onClick: actions.showActiveRun }, '查看'),
    activeCancel);

  // ---------- 輸入框與 @ 自動完成 ----------
  const listId = 'mention-list';
  let matches = [];
  let activeIndex = 0;
  let mentionRange = null;

  const mentionList = h('ul', { class: 'mentions', id: listId, role: 'listbox', 'aria-label': '可指定的 agent 與 AI', hidden: true });
  const goalInput = h('textarea', {
    id: 'goal',
    class: 'composer__input',
    rows: '2',
    maxlength: '20000',
    placeholder: '要 CueMesh 做什麼？輸入 @ 可指定 agent',
    'aria-label': '要 CueMesh 做什麼？輸入 @ 可指定 agent 或 AI，按 Ctrl 或 ⌘ 加 Enter 開始',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-controls': listId,
    'aria-expanded': 'false',
    spellcheck: 'false',
    onInput: () => {
      actions.setGoal(goalInput.value);
      autoGrow();
      refreshMentions();
    },
    onKeydown: onGoalKey,
    onClick: refreshMentions,
    onBlur: () => setTimeout(closeMentions, 120),
  });

  function autoGrow() {
    goalInput.style.height = 'auto';
    const next = Math.min(goalInput.scrollHeight, MAX_GOAL_HEIGHT);
    goalInput.style.height = `${next}px`;
    goalInput.style.overflowY = goalInput.scrollHeight > MAX_GOAL_HEIGHT ? 'auto' : 'hidden';
  }

  function refreshMentions() {
    const found = findMentionQuery(goalInput.value, goalInput.selectionStart);
    mentionRange = found;
    const next = found ? filterMentions(found.query) : [];
    if (next.length === 0) {
      closeMentions();
      return;
    }
    if (next.length !== matches.length || next[0]?.word !== matches[0]?.word) activeIndex = 0;
    matches = next;
    paintMentions();
  }

  function closeMentions() {
    matches = [];
    mentionRange = null;
    mentionList.hidden = true;
    goalInput.setAttribute('aria-expanded', 'false');
    goalInput.removeAttribute('aria-activedescendant');
  }

  function paintMentions() {
    mentionList.hidden = false;
    goalInput.setAttribute('aria-expanded', 'true');
    let lastGroup = null;
    const rows = [];
    matches.forEach((m, i) => {
      if (m.group !== lastGroup) {
        rows.push(h('li', { class: 'mentions__group', role: 'presentation' }, m.group === 'agent' ? 'Agent' : '指定 AI'));
        lastGroup = m.group;
      }
      rows.push(h('li', {
        id: `mention-${m.word}`,
        class: `mentions__item${i === activeIndex ? ' is-active' : ''}`,
        role: 'option',
        'aria-selected': i === activeIndex ? 'true' : 'false',
        // 用 mousedown 而非 click：點選時焦點才不會先離開輸入框
        onMousedown: (e) => {
          e.preventDefault();
          accept(m.word);
        },
      }, h('span', { class: 'mentions__word' }, `@${m.word}`), h('span', { class: 'mentions__label' }, m.label)));
    });
    mentionList.replaceChildren(...rows);
    goalInput.setAttribute('aria-activedescendant', `mention-${matches[activeIndex].word}`);
    mentionList.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function accept(word) {
    if (!mentionRange) return;
    const { text, caret } = applyMention(goalInput.value, mentionRange, word);
    goalInput.value = text;
    goalInput.setSelectionRange(caret, caret);
    goalInput.focus();
    closeMentions();
    actions.setGoal(text);
  }

  function onGoalKey(e) {
    // 注音、倉頡選字時的 Enter、方向鍵屬於輸入法，不能被攔截，否則中文使用者一選字就誤送出
    if (e.isComposing || e.keyCode === 229) return;
    if (matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % matches.length;
        paintMentions();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + matches.length) % matches.length;
        paintMentions();
        return;
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault();
        accept(matches[activeIndex].word);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMentions();
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      actions.start();
    }
  }

  // ---------- 開始 ----------
  const sendBtn = h('button', {
    type: 'button',
    class: 'send',
    'aria-label': '開始',
    title: '開始',
    onClick: actions.start,
  }, icon('up', 18));

  // ---------- 附加情境 ----------
  const attachMenu = createMenu({
    id: 'attach-menu',
    buttonId: 'attach-btn',
    label: '附加情境',
    leading: icon('plus', 15),
    renderItems: (close) => CONTEXT_KINDS.map((meta) => menuItem({
      label: meta.label,
      hint: meta.hint,
      leading: icon(CONTEXT_ICONS[meta.kind], 16),
      data: { 'data-context': meta.kind },
      onSelect: () => {
        close(true);
        actions.addContext(meta.kind, meta);
      },
    })),
  });
  const contextNote = h('p', { class: 'ctx-note', hidden: true });
  const chips = h('ul', { class: 'chips', 'aria-label': '已附加的情境', hidden: true });

  function chipFor(item, index) {
    const kindLabel = CONTEXT_LABELS[item.type] ?? '情境';
    const detail = clip(item.title || hostOf(item.url) || item.text || '', 28);
    const thumb = imageDataUrl(item.image);
    const preview = item.text ? clip(item.text, 200) : item.url ?? '';
    return h('li', { class: 'chip', title: preview },
      thumb && h('img', { class: 'chip__thumb', src: thumb, alt: `${kindLabel}的縮圖` }),
      h('span', { class: 'chip__body' },
        h('span', { class: 'chip__kind' }, kindLabel),
        detail && h('span', { class: 'chip__detail' }, detail)),
      h('button', {
        type: 'button',
        class: 'chip__x',
        'data-fk': `chip-${index}`,
        'aria-label': `移除情境：${kindLabel}${detail ? ` ${detail}` : ''}`,
        onClick: () => actions.removeContext(index),
      }, icon('close', 14)));
  }

  // ---------- 模式 ----------
  const modeMenu = createMenu({
    id: 'mode-menu',
    buttonId: 'mode-btn',
    label: '執行方式',
    renderItems: (close) => MODES.map((mode) => menuItem({
      label: mode.label,
      hint: mode.hint,
      checked: S.mode === mode.id,
      data: { 'data-mode': mode.id },
      onSelect: () => {
        close(true);
        actions.setMode(mode.id);
      },
    })),
  });
  const workflowSelect = h('select', {
    class: 'select select--small',
    'aria-label': '要執行的工作流',
    onChange: (e) => actions.setWorkflow(e.target.value),
  });
  const workflowEmpty = h('button', { type: 'button', class: 'linkbtn', hidden: true, onClick: () => actions.openSettings('workflows') }, '到設定頁建立工作流');
  const workflowRow = h('div', { class: 'composer__extra', hidden: true }, workflowSelect, workflowEmpty);

  // ---------- 執行裝置 ----------
  const deviceMenu = createMenu({
    id: 'device-menu',
    buttonId: 'device-btn',
    label: '執行裝置',
    align: 'end',
    renderItems: (close) => {
      const { user, device, devices } = S.cloudState;
      const targets = user ? dispatchTargets(devices, device?.id) : [];
      const pick = (value) => () => {
        close(true);
        actions.setRunTarget(value);
      };
      const item = (d) => menuItem({
        label: targetLabel(d),
        checked: S.runTarget === d.id,
        data: { 'data-device': d.id },
        onSelect: pick(d.id),
      });
      const mine = targets.filter((d) => d.mine);
      const others = targets.filter((d) => !d.mine);
      return [
        menuItem({ label: '這台裝置', checked: S.runTarget === 'local', data: { 'data-device': 'local' }, onSelect: pick('local') }),
        mine.length ? [h('p', { class: 'menu__group' }, '我的其他裝置'), mine.map(item)] : null,
        others.length ? [h('p', { class: 'menu__group' }, '其他帳號的裝置'), others.map(item)] : null,
        !cloud ? h('p', { class: 'menu__note' }, '這個版本沒有雲端模組，任務會在這台執行。') : null,
        cloud && !user ? [
          h('p', { class: 'menu__note' }, '登入後可以把任務派給其他裝置。'),
          menuItem({
            label: '前往登入',
            data: { 'data-login': 'true' },
            onSelect: () => {
              close();
              actions.openSettings('account');
            },
          }),
        ] : null,
        cloud && user && targets.length === 0 ? h('p', { class: 'menu__note' }, '目前沒有其他線上且接受派工的裝置。') : null,
      ];
    },
  });
  const targetHint = h('p', { class: 'composer__hint', id: 'run-target-hint', hidden: true });

  function paintTarget() {
    const { user, device, devices } = S.cloudState;
    const targets = user ? dispatchTargets(devices, device?.id) : [];
    const selected = targets.find((d) => d.id === S.runTarget);
    const known = devices.find((d) => d.id === S.runTarget);
    deviceMenu.setText(S.runTarget === 'local' ? '這台裝置' : deviceLabel(selected ?? known) ?? '已離線的裝置');

    // 只有派到別台時才說明：用的是對方的瀏覽器與 key，這件事不能藏起來
    let hint = '';
    if (selected?.mine) hint = '用那台裝置的瀏覽器與 API key 執行，結果會回報到歷史頁。';
    else if (selected) hint = `會用 ${selected.ownerName ?? '對方'} 的瀏覽器與 API key 執行，對方同意後才開始。你的目標與文字情境會傳給對方。`;
    const { droppedImages } = dispatchContext(S.context);
    if (S.runTarget !== 'local' && droppedImages) hint += `截圖不會傳送（${droppedImages} 張）。`;
    targetHint.hidden = !hint;
    targetHint.textContent = hint;
  }

  // ---------- 範例 ----------
  const examples = h('div', { class: 'examples', hidden: true },
    EXAMPLES.map((text) => h('button', {
      type: 'button',
      class: 'example',
      onClick: () => {
        goalInput.value = text;
        actions.setGoal(text);
        autoGrow();
        goalInput.focus();
      },
    }, text)));

  const blockerEl = h('p', { class: 'composer__hint composer__hint--warn', id: 'start-blocker', hidden: true });
  const startError = h('p', { class: 'field-error', role: 'alert', hidden: true });

  const el = h('div', { class: 'view view--task' },
    keyNotice,
    activeBanner,
    h('div', { class: 'composer' },
      h('div', { class: 'composer__box' },
        goalInput,
        h('div', { class: 'composer__send' }, sendBtn),
        mentionList),
      chips,
      contextNote,
      h('div', { class: 'composer__controls' }, attachMenu.el, modeMenu.el, deviceMenu.el),
      workflowRow,
      targetHint,
      blockerEl,
      startError),
    examples);

  // 第一次顯示前也要有名稱，輔助工具才讀得到
  attachMenu.setText('附加');
  modeMenu.setText('自動');
  deviceMenu.setText('這台裝置');

  let lastChipSig = null;
  let lastWorkflowSig = null;

  function update(justShown) {
    const connected = connectedProviders(S.keyStatus);
    const remote = S.runTarget !== 'local';
    keyNotice.hidden = connected.length > 0 || remote;
    activeBanner.hidden = !S.activeRunId;
    const activeView = S.activeRunId ? S.runViews.get(S.activeRunId) : null;
    activeCancel.disabled = Boolean(activeView?.cancelling);
    activeCancel.textContent = activeView?.cancelling ? '取消中…' : '取消任務';

    if (goalInput.value !== S.goal) {
      goalInput.value = S.goal;
      autoGrow();
    }
    if (justShown) autoGrow();

    attachMenu.setText(S.capturing ? '擷取中' : '附加');
    attachMenu.button.disabled = Boolean(S.capturing);
    if (S.capturing) attachMenu.close();
    contextNote.hidden = !S.captureNote;
    if (S.captureNote) {
      contextNote.textContent = S.captureNote.text;
      contextNote.dataset.kind = S.captureNote.kind;
      contextNote.setAttribute('role', S.captureNote.kind === 'error' ? 'alert' : 'status');
    }

    // 內容不變就不重建，鍵盤焦點才不會跳走
    const chipSig = JSON.stringify(S.context.map((c) => [c.type, c.title, c.url, c.text?.length, c.image?.data?.length]));
    if (chipSig !== lastChipSig) {
      const focusedChip = document.activeElement?.getAttribute?.('data-fk')?.startsWith('chip-');
      chips.replaceChildren(...S.context.map(chipFor));
      chips.hidden = S.context.length === 0;
      lastChipSig = chipSig;
      // 移除標籤後，焦點移到下一個標籤；都沒了就回到附加按鈕
      if (focusedChip) (chips.querySelector('.chip__x') ?? attachMenu.button).focus();
    }

    modeMenu.setText(MODES.find((m) => m.id === S.mode)?.label ?? '自動');
    const isWorkflow = S.mode === 'workflow';
    workflowRow.hidden = !isWorkflow;
    workflowSelect.hidden = S.workflows.length === 0;
    workflowEmpty.hidden = S.workflows.length > 0;
    const workflowSig = JSON.stringify(S.workflows.map((w) => [w.id, w.name]));
    if (workflowSig !== lastWorkflowSig) {
      workflowSelect.replaceChildren(...S.workflows.map((w) => h('option', { value: w.id }, w.name)));
      lastWorkflowSig = workflowSig;
    }
    if (S.workflowId) workflowSelect.value = S.workflowId;

    paintTarget();
    const blocker = getBlocker();
    sendBtn.disabled = Boolean(blocker) || S.starting;
    const sendLabel = S.starting ? '啟動中' : remote ? '派工' : '開始';
    sendBtn.setAttribute('aria-label', sendLabel);
    sendBtn.title = sendLabel;
    // 空白目標與沒有 key 已經看得出來，其他原因才需要說明
    const hasGoal = Boolean(S.goal.trim());
    const showBlocker = Boolean(blocker) && (hasGoal || isWorkflow || S.mode === 'council') && !S.activeRunId && !(connected.length === 0 && !remote);
    blockerEl.hidden = !showBlocker;
    blockerEl.textContent = showBlocker ? blocker : '';
    if (showBlocker) sendBtn.setAttribute('aria-describedby', 'start-blocker');
    else sendBtn.removeAttribute('aria-describedby');
    startError.hidden = !S.startError;
    startError.textContent = S.startError ?? '';

    examples.hidden = !(S.runs.length === 0 && !S.goal && S.context.length === 0 && !S.activeRunId);
  }

  return {
    el,
    update,
    setGoal(goal) {
      goalInput.value = goal;
      autoGrow();
    },
    clearGoal() {
      goalInput.value = '';
      autoGrow();
      closeMentions();
    },
    focusGoal() {
      setTimeout(() => goalInput.focus(), 40);
    },
  };
}
