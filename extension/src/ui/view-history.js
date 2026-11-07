// 歷史頁：目前專案的任務紀錄與專案管理
import { confirmButton, h } from './dom.js';
import { renderMarkdown, safeUrl } from './markdown.js';
import { clip, deviceLabel, dispatchStatus, formatUsd, hostOf, isDispatchOpen, RUN_STATUS_LABELS, stripControls } from './logic.js';

const dateFormat = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const when = (ms) => (ms ? dateFormat.format(new Date(ms)) : '時間不明');
const LAMP = { planning: 'pending', partial: 'warning', cancelled: 'off' };

export function createHistoryView({ S, actions }) {
  const heading = h('div', { class: 'block-head' });
  const list = h('div');
  const danger = h('div', { class: 'history__danger' });
  const dispatchBox = h('div');
  const el = h('div', { class: 'view view--history' }, dispatchBox, heading, list, danger);
  let lastSig = null;
  let lastDispatchSig = null;

  function buildDispatch(d) {
    const incoming = d.direction === 'incoming';
    // 收到的派工還沒接受時，是在等這台的使用者，不是等對方
    const status = incoming && d.status === 'pending' ? { ...dispatchStatus(d.status), label: '等你決定' } : dispatchStatus(d.status);
    const target = S.cloudState.devices.find((x) => x.id === d.targetDeviceId);
    const direction = incoming
      ? `來自 ${stripControls(d.senderName) || '不明的使用者'}`
      : `派給 ${deviceLabel(target) ?? '其他裝置'}`;
    const sources = (d.sources ?? []).map((src) => ({ title: src?.title, url: safeUrl(src?.url) })).filter((src) => src.url);
    const report = d.result || d.summary;
    const key = `dispatch-${d.id}`;
    return h('li', { class: 'dispatch', 'data-status': d.status },
      h('span', { class: 'lamp', 'data-status': status.lamp, 'aria-hidden': 'true' }),
      h('div', { class: 'dispatch__body' },
        h('p', { class: 'dispatch__goal' }, clip(stripControls(d.goal), 120) || '（沒有內容）'),
        h('p', { class: 'dispatch__meta' },
          h('span', { class: `tag${incoming ? ' tag--accent' : ''}` }, direction),
          h('strong', { class: 'dispatch__state' }, status.label),
          d.createdAt ? h('span', null, when(d.createdAt)) : null,
          typeof d.costUsd === 'number' && d.costUsd > 0 && h('span', null, formatUsd(d.costUsd))),
        d.error && h('p', { class: 'cue__error' }, stripControls(d.error)),
        report && h('details', {
          class: 'drawer',
          open: S.openDetails.has(key),
          onToggle: (e) => actions.toggleDetail(key, e.target.open),
        },
        h('summary', { class: 'drawer__summary' }, '查看回報'),
        h('div', { class: 'drawer__body' },
          h('div', { class: 'md' }, renderMarkdown(report)),
          sources.length ? h('ul', { class: 'sources' }, sources.map((src) => h('li', null,
            h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer nofollow', title: src.url },
              h('span', { class: 'sources__title' }, src.title || hostOf(src.url)),
              h('span', { class: 'sources__host' }, hostOf(src.url)))))) : null)),
        // 收到且還沒決定的派工由同意視窗處理，這裡不給第二個入口
        isDispatchOpen(d.status) && !(incoming && d.status === 'pending') && h('button', {
          type: 'button',
          class: 'btn btn--quiet btn--small dispatch__cancel',
          'aria-label': `取消派工：${clip(stripControls(d.goal), 40)}`,
          onClick: () => actions.cancelDispatch(d.id),
        }, '取消派工')));
  }

  function updateDispatches() {
    const { user, dispatches, dispatchesError, devices } = S.cloudState;
    const sig = JSON.stringify([Boolean(user), dispatches, dispatchesError, devices.map((d) => [d.id, d.name])]);
    if (sig === lastDispatchSig) return;
    lastDispatchSig = sig;
    if (!user) {
      dispatchBox.replaceChildren();
      return;
    }
    dispatchBox.replaceChildren(h('section', { class: 'dispatches', 'aria-labelledby': 'dispatches-title' },
      h('div', { class: 'block-head' },
        h('h2', { class: 'view-title', id: 'dispatches-title' }, '派工'),
        h('span', { class: 'block-count' }, `${dispatches.length} 筆`)),
      dispatchesError
        ? h('p', { class: 'field-error', role: 'alert' }, dispatchesError)
        : dispatches.length
          ? h('ol', { class: 'dispatch-list' }, dispatches.slice(0, 30).map(buildDispatch))
          : h('p', { class: 'muted' }, '還沒有派工。在任務頁選「在哪裡執行」，可以把任務派給其他裝置。')));
  }

  function update() {
    updateDispatches();
    const project = S.projects.find((p) => p.id === S.projectId);
    const sig = JSON.stringify([S.projectId, project?.name, S.projects.length, project?.remoteOnly, S.runs, S.runsError, S.activeRunId]);
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
      project && !project.remoteOnly
        ? confirmButton({
          label: `刪除專案「${clip(project.name, 16)}」`,
          confirmLabel: '再按一次確定刪除（連同所有任務紀錄）',
          className: 'btn btn--quiet btn--small',
          onConfirm: () => actions.deleteProject(project.id),
        })
        : null,
    );
    if (!project || project.remoteOnly) danger.replaceChildren();
  }

  return { el, update };
}
