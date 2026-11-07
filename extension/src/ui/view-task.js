// 任務頁：目標輸入、@ 自動完成、情境附加、模式切換、開始／取消。第一次使用時先引導設定 API key。
import { h, icon } from './dom.js';
import {
  applyMention, CONTEXT_KINDS, connectedProviders, filterMentions, findMentionQuery, formatUsd, hostOf, imageDataUrl,
  PROVIDERS, clip, startBlocker,
} from './logic.js';

const MODES = [
  { id: 'auto', label: '自動', hint: '由 AI 拆解工作，分給最適合的 agent。' },
  { id: 'council', label: 'AI 議會', hint: '多家 AI 各自作答，再整理共識與分歧。至少要兩家的 API key。' },
  { id: 'workflow', label: '工作流', hint: '照你存好的固定步驟執行。' },
];
const CONTEXT_ICONS = { selection: 'selection', region: 'region', element: 'element', page: 'page' };
const CONTEXT_LABELS = Object.fromEntries(CONTEXT_KINDS.map((c) => [c.kind, c.label]));

export function createTaskView({ S, actions, blockerInput }) {
  // ---------- 引導 ----------
  const guideLamps = h('ul', { class: 'guide__lamps' });
  const guide = h('section', { class: 'guide', 'aria-labelledby': 'guide-title', hidden: true },
    h('p', { class: 'guide__kicker' }, '開工前的第一步'),
    h('h2', { class: 'guide__title', id: 'guide-title' }, '先點亮一盞燈'),
    h('p', { class: 'guide__text' }, 'CueMesh 用你自己的 API key 呼叫 AI。每接上一家就亮一盞燈，至少要一盞才能開工。'),
    guideLamps,
    h('button', {
      type: 'button',
      class: 'btn btn--primary btn--block',
      onClick: () => actions.openSettings('keys'),
    }, icon('key'), '設定 API key'),
    h('p', { class: 'guide__note' }, 'key 只存在這個瀏覽器，不會傳給 CueMesh 網站。費用由各家 AI 依用量向你收取。'));

  // ---------- 執行中提示 ----------
  const activeBanner = h('div', { class: 'callout callout--live', hidden: true },
    h('span', { class: 'lamp', 'data-status': 'running', 'aria-hidden': 'true' }),
    h('span', { class: 'callout__text' }, '有任務正在執行'),
    h('button', { type: 'button', class: 'btn btn--ink btn--small', onClick: actions.showActiveRun }, '查看'));

  // ---------- 目標與 @ 自動完成 ----------
  const listId = 'mention-list';
  let matches = [];
  let activeIndex = 0;
  let mentionRange = null;

  const mentionList = h('ul', { class: 'mentions', id: listId, role: 'listbox', 'aria-label': '可指定的 agent 與 AI', hidden: true });
  const goalInput = h('textarea', {
    id: 'goal',
    class: 'goal',
    rows: '4',
    maxlength: '20000',
    placeholder: '例如：比較這三個產品的價格，整理成表格',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-controls': listId,
    'aria-expanded': 'false',
    'aria-describedby': 'goal-help',
    spellcheck: 'false',
    onInput: () => {
      actions.setGoal(goalInput.value);
      refreshMentions();
    },
    onKeydown: onGoalKey,
    onClick: refreshMentions,
    onBlur: () => setTimeout(closeMentions, 120),
  });

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

  // ---------- 情境 ----------
  const contextButtons = new Map(CONTEXT_KINDS.map((meta) => [meta.kind, h('button', {
    type: 'button',
    class: 'ctxbtn',
    title: meta.hint,
    onClick: () => actions.addContext(meta.kind, meta),
  }, icon(CONTEXT_ICONS[meta.kind]), h('span', null, meta.label))]));
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
  const modeInputs = new Map();
  const modeGroup = h('div', { class: 'modes', role: 'radiogroup', 'aria-labelledby': 'mode-title' },
    MODES.map((mode) => {
      const input = h('input', {
        type: 'radio',
        name: 'mode',
        value: mode.id,
        class: 'modes__input',
        onChange: () => actions.setMode(mode.id),
      });
      modeInputs.set(mode.id, input);
      return h('label', { class: 'modes__item' }, input, h('span', { class: 'modes__label' }, mode.label));
    }));
  const modeHint = h('p', { class: 'hint', id: 'mode-hint' });
  const workflowSelect = h('select', {
    class: 'select',
    'aria-label': '要執行的工作流',
    onChange: (e) => actions.setWorkflow(e.target.value),
  });
  const workflowRow = h('div', { class: 'workflow-pick', hidden: true }, workflowSelect);
  const workflowEmpty = h('button', {
    type: 'button',
    class: 'btn btn--quiet btn--small',
    hidden: true,
    onClick: () => actions.openSettings('workflows'),
  }, '到設定頁建立工作流');

  // ---------- 開始與取消 ----------
  const startLabel = h('span', null, '開始');
  const startBtn = h('button', {
    type: 'button',
    class: 'btn btn--primary btn--cue',
    onClick: actions.start,
  }, h('span', { class: 'lamp lamp--button', 'aria-hidden': 'true' }), startLabel);
  const cancelBtn = h('button', {
    type: 'button',
    class: 'btn btn--danger',
    hidden: true,
    onClick: () => S.activeRunId && actions.cancel(S.activeRunId),
  }, '取消任務');
  const blockerEl = h('p', { class: 'hint hint--blocker', id: 'start-blocker' });
  const startError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const summary = h('p', { class: 'cue-summary' });

  const section = (no, titleId, title, ...children) => h('section', { class: 'part', 'aria-labelledby': titleId },
    h('span', { class: 'part__no', 'aria-hidden': 'true' }, no),
    h('h2', { class: 'part__title', id: titleId }, title),
    ...children);

  const el = h('div', { class: 'view view--task' },
    guide,
    activeBanner,
    section('一', 'goal-title', h('label', { for: 'goal' }, '這次要做什麼'),
      h('div', { class: 'goal-wrap' }, goalInput, mentionList),
      h('p', { class: 'hint', id: 'goal-help' }, '輸入 @ 指定 agent 或 AI。按 Ctrl 或 ⌘ 加 Enter 開始。')),
    section('二', 'ctx-title', '指給 AI 看',
      h('div', { class: 'ctxgrid' }, [...contextButtons.values()]),
      contextNote,
      chips),
    section('三', 'mode-title', '怎麼做',
      modeGroup,
      modeHint,
      workflowRow,
      workflowEmpty),
    h('div', { class: 'cue-bar' },
      blockerEl,
      startError,
      h('div', { class: 'cue-bar__actions' }, startBtn, cancelBtn),
      summary));

  let lastChipSig = null;
  let lastWorkflowSig = null;

  function update() {
    const connected = connectedProviders(S.keyStatus);
    guide.hidden = connected.length > 0;
    guideLamps.replaceChildren(...PROVIDERS.map((p) => h('li', { class: 'guide__lamp' },
      h('span', { class: 'lamp', 'data-status': 'pending', 'aria-hidden': 'true' }),
      p.label)));

    activeBanner.hidden = !S.activeRunId;

    if (goalInput.value !== S.goal) goalInput.value = S.goal;

    for (const [kind, button] of contextButtons) {
      button.disabled = Boolean(S.capturing);
      button.classList.toggle('is-busy', S.capturing === kind);
      if (S.capturing === kind) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    }
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
      // 移除標籤後，焦點移到下一個標籤；都沒了就回到情境按鈕
      if (focusedChip || !document.activeElement || document.activeElement === document.body) {
        const next = chips.querySelector('.chip__x');
        if (focusedChip) (next ?? contextButtons.get('selection')).focus();
      }
    }

    for (const [id, input] of modeInputs) input.checked = id === S.mode;
    modeHint.textContent = MODES.find((m) => m.id === S.mode)?.hint ?? '';
    const isWorkflow = S.mode === 'workflow';
    workflowRow.hidden = !isWorkflow || S.workflows.length === 0;
    workflowEmpty.hidden = !isWorkflow || S.workflows.length > 0;
    const workflowSig = JSON.stringify(S.workflows.map((w) => [w.id, w.name]));
    if (workflowSig !== lastWorkflowSig) {
      workflowSelect.replaceChildren(...S.workflows.map((w) => h('option', { value: w.id }, w.name)));
      lastWorkflowSig = workflowSig;
    }
    if (S.workflowId) workflowSelect.value = S.workflowId;

    const blocker = startBlocker(blockerInput());
    startBtn.disabled = Boolean(blocker) || S.starting;
    startBtn.classList.toggle('is-ready', !blocker && !S.starting);
    startLabel.textContent = S.starting ? '啟動中…' : '開始';
    if (blocker) startBtn.setAttribute('aria-describedby', 'start-blocker');
    else startBtn.removeAttribute('aria-describedby');
    blockerEl.textContent = blocker ?? '';
    blockerEl.hidden = !blocker;
    cancelBtn.hidden = !S.activeRunId;
    const activeView = S.activeRunId ? S.runViews.get(S.activeRunId) : null;
    cancelBtn.disabled = Boolean(activeView?.cancelling);
    cancelBtn.textContent = activeView?.cancelling ? '取消中…' : '取消任務';
    startError.hidden = !S.startError;
    startError.textContent = S.startError ?? '';

    const approvalText = S.settings.approvalMode === 'risky' ? '只問高風險動作' : '每個動作都先問你';
    summary.textContent = `預算上限 ${formatUsd(S.settings.maxCostUsd)}，瀏覽器動作${approvalText}。`;
  }

  return {
    el,
    update,
    setGoal(goal) {
      goalInput.value = goal;
    },
    clearGoal() {
      goalInput.value = '';
      closeMentions();
    },
    focusGoal() {
      setTimeout(() => goalInput.focus(), 40);
    },
  };
}
