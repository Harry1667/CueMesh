// 歷史頁：目前專案的任務紀錄與專案管理
import { confirmButton, h } from './dom.js';
import { clip, formatUsd, RUN_STATUS_LABELS } from './logic.js';

const dateFormat = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const when = (ms) => (ms ? dateFormat.format(new Date(ms)) : '時間不明');
const LAMP = { planning: 'pending', partial: 'warning', cancelled: 'off' };

export function createHistoryView({ S, actions }) {
  const heading = h('div', { class: 'block-head' });
  const list = h('div');
  const danger = h('div', { class: 'history__danger' });
  const el = h('div', { class: 'view view--history' }, heading, list, danger);
  let lastSig = null;

  function update() {
    const project = S.projects.find((p) => p.id === S.projectId);
    const sig = JSON.stringify([S.projectId, project?.name, S.projects.length, S.runs, S.runsError, S.activeRunId]);
    if (sig === lastSig) return;
    lastSig = sig;

    heading.replaceChildren(
      h('h2', { class: 'view-title' }, '任務歷史'),
      h('span', { class: 'block-count' }, `${S.runs.length} 筆`),
    );

    if (S.runsError) {
      list.replaceChildren(h('div', { class: 'callout callout--danger', role: 'alert' }, S.runsError));
    } else if (S.runs.length === 0) {
      list.replaceChildren(h('div', { class: 'empty' },
        h('p', { class: 'empty__title' }, '這個專案還沒有任務'),
        h('button', { type: 'button', class: 'btn btn--ink', onClick: actions.newTask }, '開始第一個任務')));
    } else {
      list.replaceChildren(h('ol', { class: 'runs' }, S.runs.map((run) => h('li', null,
        h('button', {
          type: 'button',
          class: 'runrow',
          'aria-label': `${clip(run.goal, 80)}，${RUN_STATUS_LABELS[run.status] ?? run.status}，${when(run.createdAt)}`,
          onClick: () => actions.openRun(run.id),
        },
        h('span', { class: 'lamp', 'data-status': LAMP[run.status] ?? run.status, 'aria-hidden': 'true' }),
        h('span', { class: 'runrow__body' },
          h('span', { class: 'runrow__goal' }, clip(run.goal, 80) || '（沒有目標文字）'),
          h('span', { class: 'runrow__meta' },
            h('span', null, RUN_STATUS_LABELS[run.status] ?? run.status),
            h('span', null, when(run.createdAt)),
            run.costUsd !== null && h('span', null, formatUsd(run.costUsd)))))))));
    }

    danger.replaceChildren(
      project
        ? confirmButton({
          label: `刪除專案「${clip(project.name, 16)}」`,
          confirmLabel: '再按一次確定刪除（連同所有任務紀錄）',
          className: 'btn btn--quiet btn--small',
          onConfirm: () => actions.deleteProject(project.id),
        })
        : null,
    );
    if (!project) danger.replaceChildren();
  }

  return { el, update };
}
