// 執行畫面：計畫、費用、子任務軌道、@ 委派、備援、瀏覽器紀錄、最終結果、成果檔案。
// 這裡顯示的文字幾乎都來自模型或網頁，只能用文字節點或 renderMarkdown，不可當 HTML。
import { h, icon, replaceKeepingFocus } from './dom.js';
import { renderMarkdown } from './markdown.js';
import {
  AGENT_LABELS, collectSources, describeArgs, formatDuration, formatUsd, hostOf, isFinished, RUN_STATUS_LABELS,
  safeFilename, TASK_STATUS_LABELS, taskProgress, taskTree, toolLabel, clip,
} from './logic.js';

const LOG_STATE = {
  pending: { label: '進行中', mark: '…' },
  ok: { label: '完成', mark: '✓' },
  denied: { label: '已拒絕', mark: '✕' },
  error: { label: '失敗', mark: '!' },
  abandoned: { label: '未完成', mark: '–' },
};
const FALLBACK_STAGE = { planning: '規劃', synthesis: '整合結果' };
const KIND_LABELS = { html: '網頁', code: '程式碼', markdown: '文件', data: '資料' };
const needsKeyHelp = (message) => /api\s*key|金鑰|401|403|unauthor|invalid.*key/i.test(message ?? '');
const pad = (n) => String(n).padStart(2, '0');

function md(text) {
  return h('div', { class: 'md' }, renderMarkdown(text));
}

export function createRunScreen({ S, actions, previewUrl }) {
  const header = h('div');
  const costEl = h('div');
  const planEl = h('div');
  const tasksEl = h('div');
  const feedEl = h('div');
  const browserEl = h('div');
  const resultEl = h('div');
  const artifactsEl = h('div');
  const body = h('div', { class: 'run__body' });
  const clockEl = h('span', { class: 'run__clock', 'aria-hidden': 'true' });

  const cancelBtn = h('button', {
    type: 'button',
    class: 'btn btn--danger btn--block',
    onClick: () => S.shownRunId && actions.cancel(S.shownRunId),
  }, '取消任務');
  const footer = h('div', { class: 'run__footer', hidden: true }, cancelBtn);

  const backBtn = h('button', { type: 'button', class: 'linkbtn', onClick: actions.newTask }, icon('back', 14), '新任務');
  const el = h('div', { class: 'view view--run' },
    h('div', { class: 'run__nav' }, backBtn, clockEl),
    header,
    body,
    footer);

  const signatures = new Map();
  function patch(container, signature, build) {
    if (signatures.get(container) === signature) return;
    signatures.set(container, signature);
    replaceKeepingFocus(container, [build()]);
  }

  const detailBlock = (key, summary, content, { defaultOpen = false } = {}) => {
    const open = S.openDetails.has(key) || (defaultOpen && !S.openDetails.has(`closed:${key}`));
    return h('details', {
      class: 'drawer',
      open,
      onToggle: (e) => {
        actions.toggleDetail(key, e.target.open);
        if (e.target.open) S.openDetails.delete(`closed:${key}`);
        else S.openDetails.add(`closed:${key}`);
      },
    }, h('summary', { class: 'drawer__summary', 'data-fk': `summary-${key}` }, summary), content);
  };

  // ---------- 標題 ----------
  function buildHeader(view) {
    const { run } = view;
    const status = view.cancelling ? 'cancelling' : run.status;
    const label = view.cancelling ? '取消中' : RUN_STATUS_LABELS[run.status] ?? run.status;
    return h('header', { class: 'run__head' },
      h('p', { class: 'run__status', 'data-status': status },
        h('span', { class: 'lamp', 'data-status': lampFor(status), 'aria-hidden': 'true' }),
        h('span', null, label)),
      h('h2', { class: 'run__goal' }, run.goal || '（沒有目標文字）'),
      view.context?.length
        ? h('p', { class: 'run__context' }, `附加了 ${view.context.length} 項情境`)
        : null);
  }

  function lampFor(status) {
    if (status === 'planning' || status === 'cancelling') return 'pending';
    if (status === 'partial') return 'warning';
    if (status === 'cancelled') return 'off';
    return status;
  }

  // ---------- 費用 ----------
  function buildCost(view) {
    const spent = view.run.costUsd ?? 0;
    const limit = view.maxCostUsd;
    const estimate = view.plan?.estimatedCostUsd ?? null;
    const scale = limit && limit > 0 ? limit : Math.max(estimate ?? 0, spent, 0.01);
    const fill = h('span', { class: 'meter__fill' });
    fill.style.width = `${Math.min((spent / scale) * 100, 100)}%`;
    const meter = h('div', {
      class: 'meter',
      role: 'meter',
      'aria-label': '已用預算',
      'aria-valuemin': '0',
      'aria-valuemax': String(scale),
      'aria-valuenow': String(Math.min(spent, scale)),
      'aria-valuetext': `已用 ${formatUsd(spent)}${limit ? `，上限 ${formatUsd(limit)}` : ''}`,
    }, fill);
    if (estimate !== null && estimate <= scale) {
      const tick = h('span', { class: 'meter__tick', title: `預估 ${formatUsd(estimate)}` });
      tick.style.left = `${(estimate / scale) * 100}%`;
      meter.appendChild(tick);
    }
    return h('section', { class: 'ledger', 'aria-label': '費用' },
      h('dl', { class: 'ledger__grid' },
        h('div', { class: 'ledger__cell ledger__cell--main' }, h('dt', null, '累計費用'), h('dd', null, formatUsd(spent))),
        h('div', { class: 'ledger__cell' }, h('dt', null, '預估'), h('dd', null, estimate === null ? '規劃中' : formatUsd(estimate))),
        h('div', { class: 'ledger__cell' }, h('dt', null, '上限'), h('dd', null, limit ? formatUsd(limit) : '—'))),
      meter,
      h('p', { class: 'ledger__note' },
        `輸入 ${(view.run.inputTokens ?? 0).toLocaleString('zh-TW')}、輸出 ${(view.run.outputTokens ?? 0).toLocaleString('zh-TW')} token。依公開牌價估算，不是帳單金額。`));
  }

  // ---------- 計畫 ----------
  function buildPlan(view) {
    const summary = view.plan?.summary || view.run.planSummary;
    if (!summary && !isFinished(view.run.status)) {
      return h('section', { class: 'plan plan--waiting' },
        h('h3', { class: 'block-title' }, '計畫'),
        h('p', { class: 'muted' }, '正在把目標拆成子任務…'));
    }
    if (!summary) return null;
    return h('section', { class: 'plan', 'aria-labelledby': 'plan-title' },
      h('h3', { class: 'block-title', id: 'plan-title' }, '計畫'),
      h('p', { class: 'plan__text' }, summary));
  }

  // ---------- 子任務軌道 ----------
  function buildCue(node, label, depth) {
    const { task } = node;
    const statusLabel = TASK_STATUS_LABELS[task.status] ?? task.status;
    const duration = task.startedAt && task.finishedAt ? formatDuration(task.finishedAt - task.startedAt) : null;
    const agentName = task.agent ? `@${task.agent}` : '未指定';
    // 要轉成布林：長度 0 若直接往下傳，會被當成文字「0」顯示在畫面上
    const hasDetail = Boolean(task.result || task.messages.length || task.sources.length);

    return h('li', { class: `cue${depth > 0 ? ' cue--child' : ''}`, 'data-status': task.status },
      h('span', {
        class: 'lamp cue__lamp',
        'data-status': task.status,
        'aria-hidden': 'true',
      }),
      h('div', { class: 'cue__body' },
        h('div', { class: 'cue__head' },
          h('span', { class: 'cue__no', 'aria-hidden': 'true' }, label),
          h('span', { class: 'cue__title' }, task.title)),
        h('p', { class: 'cue__meta' },
          h('span', { class: 'tag', title: AGENT_LABELS[task.agent] ?? '' }, agentName),
          task.model && h('span', { class: 'cue__model', title: task.provider ?? '' }, task.model),
          h('span', { class: 'cue__state' }, statusLabel),
          duration && h('span', { class: 'cue__time' }, duration)),
        task.mention && h('p', { class: 'cue__via' },
          h('strong', null, `由 @${task.mention.fromAgent ?? '其他 agent'} 委派`),
          `：${clip(task.mention.request, 120)}`),
        task.fallbacks.map((f) => h('p', { class: 'cue__fallback' },
          h('strong', null, `改用備援模型 ${f.model ?? ''}`),
          f.reason ? `：${clip(f.reason, 140)}` : '')),
        task.error && h('p', { class: 'cue__error' }, task.error),
        hasDetail && detailBlock(`task-${task.id}`, task.result ? '查看這一步的成果' : '查看過程', h('div', { class: 'drawer__body' },
          task.messages.map((m) => h('p', { class: 'cue__message' }, m)),
          task.result && md(task.result),
          task.sources.length ? sourceList(task.sources) : null))),
      node.children.length
        ? h('ol', { class: 'cues cues--nested' }, node.children.map((child, i) => buildCue(child, `${label}.${i + 1}`, depth + 1)))
        : null);
  }

  function buildTasks(view) {
    const tree = taskTree(view);
    const { total, done, failed, running } = taskProgress(view);
    if (total === 0) {
      const planned = view.plan?.tasks ?? [];
      return h('section', { class: 'tasks', 'aria-labelledby': 'tasks-title' },
        h('h3', { class: 'block-title', id: 'tasks-title' }, '子任務'),
        planned.length
          ? h('ol', { class: 'cues' }, planned.map((t, i) => h('li', { class: 'cue', 'data-status': 'pending' },
            h('span', { class: 'lamp cue__lamp', 'data-status': 'pending', 'aria-hidden': 'true' }),
            h('div', { class: 'cue__body' },
              h('div', { class: 'cue__head' }, h('span', { class: 'cue__no' }, pad(i + 1)), h('span', { class: 'cue__title' }, t.title)),
              h('p', { class: 'cue__meta' }, h('span', { class: 'tag' }, `@${t.agent}`), h('span', { class: 'cue__state' }, '等待中'))))))
          : h('p', { class: 'muted' }, '還沒有子任務。'));
    }
    const progress = [`${done}／${total} 完成`];
    if (running) progress.push(`${running} 個執行中`);
    if (failed) progress.push(`${failed} 個失敗`);
    return h('section', { class: 'tasks', 'aria-labelledby': 'tasks-title' },
      h('div', { class: 'block-head' },
        h('h3', { class: 'block-title', id: 'tasks-title' }, '子任務'),
        h('span', { class: 'block-count' }, progress.join('，'))),
      h('ol', { class: 'cues' }, tree.map((node, i) => buildCue(node, pad(i + 1), 0))));
  }

  // ---------- 協作動態 ----------
  function feedRow(entry) {
    switch (entry.kind) {
      case 'mention':
        return h('li', { class: 'feed__row feed__row--mention' },
          h('span', { class: 'tag' }, `@${entry.fromAgent ?? '?'}`),
          h('span', { class: 'feed__arrow' }, '請'),
          h('span', { class: 'tag tag--accent' }, `@${entry.agent ?? '?'}`),
          h('span', { class: 'feed__text' }, clip(entry.request, 160)));
      case 'fallback':
        return h('li', { class: 'feed__row feed__row--fallback' },
          h('strong', null, entry.stage ? `${FALLBACK_STAGE[entry.stage] ?? entry.stage}階段換模型` : '改用備援模型'),
          h('span', { class: 'feed__text' }, `${entry.model ?? ''}${entry.reason ? `：${clip(entry.reason, 160)}` : ''}`));
      case 'message':
        return h('li', { class: 'feed__row' }, h('span', { class: 'feed__text' }, clip(entry.text, 240)));
      case 'tool':
        return h('li', { class: 'feed__row feed__row--tool' },
          h('span', { class: 'feed__tool' }, toolLabel(entry.tool)),
          h('span', { class: 'feed__text' }, describeArgs(entry.tool, entry.args)));
      default:
        return h('li', { class: 'feed__row feed__row--notice' }, h('span', { class: 'feed__text' }, entry.text ?? ''));
    }
  }

  function buildFeed(view) {
    if (view.feed.length === 0) return null;
    const hasAttention = view.feed.some((e) => e.kind === 'mention' || e.kind === 'fallback');
    return detailBlock('feed',
      h('span', { class: 'drawer__label' }, '協作動態', h('span', { class: 'block-count' }, String(view.feed.length))),
      h('ol', { class: 'feed' }, view.feed.slice(-60).map(feedRow)),
      { defaultOpen: hasAttention });
  }

  // ---------- 瀏覽器動作 ----------
  function buildBrowserLog(view) {
    if (view.browserLog.length === 0) return null;
    return detailBlock('browser',
      h('span', { class: 'drawer__label' }, '瀏覽器動作', h('span', { class: 'block-count' }, String(view.browserLog.length))),
      h('ol', { class: 'log' }, view.browserLog.slice(-60).map((entry) => {
        const state = LOG_STATE[entry.state] ?? LOG_STATE.pending;
        return h('li', { class: 'log__row', 'data-state': entry.state },
          h('span', { class: 'log__mark', 'aria-hidden': 'true' }, state.mark),
          h('div', { class: 'log__body' },
            h('span', { class: 'log__tool' }, toolLabel(entry.tool)),
            h('span', { class: 'log__args' }, describeArgs(entry.tool, entry.args)),
            h('span', { class: 'log__state' }, state.label),
            entry.error && h('p', { class: 'log__error' }, entry.error)));
      })),
      { defaultOpen: true });
  }

  // ---------- 結果 ----------
  function sourceList(sources) {
    return h('ul', { class: 'sources' }, sources.map((s) => h('li', null,
      h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer nofollow', title: s.url },
        h('span', { class: 'sources__title' }, s.title || hostOf(s.url)),
        h('span', { class: 'sources__host' }, hostOf(s.url))))));
  }

  function buildResult(view) {
    const { run } = view;
    const finished = isFinished(run.status);
    if (!finished) return null;
    const sources = collectSources(view);
    const parts = [];

    if (run.status === 'failed') {
      const message = run.error || '任務失敗，但沒有收到原因。';
      parts.push(h('div', { class: 'outcome outcome--failed', role: 'alert' },
        h('h3', { class: 'outcome__title' }, '任務失敗'),
        h('p', { class: 'outcome__text' }, message),
        h('div', { class: 'row row--wrap' },
          h('button', { type: 'button', class: 'btn btn--ink', 'data-fk': 'retry', onClick: () => actions.retry(view) }, '修改後重試'),
          needsKeyHelp(message) && h('button', { type: 'button', class: 'btn btn--quiet', onClick: () => actions.openSettings('keys') }, '檢查 API key'))));
    } else if (run.status === 'cancelled') {
      parts.push(h('div', { class: 'outcome outcome--cancelled' },
        h('h3', { class: 'outcome__title' }, '任務已取消'),
        h('p', { class: 'outcome__text' }, '已經完成的成果還在下方。費用只計算到取消為止。'),
        h('button', { type: 'button', class: 'btn btn--ink', 'data-fk': 'retry', onClick: () => actions.retry(view) }, '修改後重試')));
    } else if (run.status === 'partial') {
      const { failed, total } = taskProgress(view);
      parts.push(h('div', { class: 'outcome outcome--partial', role: 'status' },
        h('h3', { class: 'outcome__title' }, '部分完成'),
        h('p', { class: 'outcome__text' }, `${total} 個子任務中有 ${failed} 個沒有完成，下方結果可能不完整。`)));
    }

    if (run.finalResult) {
      const copy = h('button', {
        type: 'button',
        class: 'iconbtn iconbtn--label',
        'data-fk': 'copy-result',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(run.finalResult);
            actions.notify('已複製結果', 'info');
          } catch (err) {
            actions.notify(`無法複製：${err.message}`);
          }
        },
      }, icon('copy', 14), '複製');
      parts.push(h('section', { class: 'result', 'aria-labelledby': 'result-title' },
        h('div', { class: 'block-head' },
          h('h3', { class: 'block-title block-title--strong', id: 'result-title' }, '最終結果'),
          copy),
        md(run.finalResult)));
    }
    if (sources.length) {
      parts.push(h('section', { class: 'result-sources', 'aria-labelledby': 'sources-title' },
        h('h3', { class: 'block-title', id: 'sources-title' }, `來源（${sources.length}）`),
        sourceList(sources)));
    }
    return parts;
  }

  // ---------- 成果檔案 ----------
  function download(artifact) {
    if (artifact.content === null || artifact.content === undefined) {
      actions.notify('這個檔案的內容還沒載入，請稍後再試。');
      return;
    }
    const url = URL.createObjectURL(new Blob([artifact.content], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFilename(artifact.name);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    actions.announce(`已下載 ${artifact.name}`);
  }

  // HTML 成果由 AI 產生，一定放在 sandbox iframe：只給 allow-scripts，不給 allow-same-origin，
  // 裡面的程式是獨立的不透明來源，碰不到擴充功能的 API、儲存空間（含 API key）與父頁面。
  function buildPreview(artifact) {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', `${artifact.name} 的預覽（隔離環境）`);
    frame.className = 'preview__frame';
    if (previewUrl) {
      // 擴充功能頁面的安全政策會擋 srcdoc 內的行內指令碼，所以改用 manifest 宣告的沙盒頁面接收內容
      frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage({ type: 'cuemesh-preview', html: artifact.content ?? '' }, '*');
      });
      frame.setAttribute('src', previewUrl);
    } else {
      frame.setAttribute('srcdoc', artifact.content ?? '');
    }
    return h('div', { class: 'preview' }, frame,
      h('p', { class: 'preview__note' }, '在隔離環境中執行，無法存取你的資料與其他分頁。'));
  }

  function artifactRow(artifact) {
    const key = artifact.id ?? artifact.name;
    const isHtml = artifact.kind === 'html';
    const open = isHtml && S.openPreviews.has(key);
    const loaded = artifact.content !== null && artifact.content !== undefined;
    return h('li', { class: 'file' },
      h('div', { class: 'file__row' },
        h('div', { class: 'file__info' },
          h('span', { class: 'file__name' }, artifact.name),
          h('span', { class: 'file__meta' },
            `${KIND_LABELS[artifact.kind] ?? artifact.kind}${artifact.createdBy ? `，由 @${artifact.createdBy} 產生` : ''}${loaded ? '' : '，載入中…'}`)),
        h('div', { class: 'file__actions' },
          isHtml && h('button', {
            type: 'button',
            class: 'iconbtn iconbtn--label',
            'data-fk': `preview-${key}`,
            'aria-expanded': open ? 'true' : 'false',
            disabled: !loaded,
            onClick: () => actions.togglePreview(key),
          }, icon('eye', 14), open ? '收起' : '預覽'),
          h('button', {
            type: 'button',
            class: 'iconbtn iconbtn--label',
            'data-fk': `download-${key}`,
            disabled: !loaded,
            'aria-label': `下載 ${artifact.name}`,
            onClick: () => download(artifact),
          }, icon('download', 14), '下載'))),
      open && loaded ? buildPreview(artifact) : null);
  }

  function buildArtifacts(view) {
    if (view.artifacts.length === 0) return null;
    return h('section', { class: 'files', 'aria-labelledby': 'files-title' },
      h('h3', { class: 'block-title', id: 'files-title' }, `成果檔案（${view.artifacts.length}）`),
      h('ul', { class: 'files__list' }, view.artifacts.map(artifactRow)));
  }

  // ---------- 更新 ----------
  function tick() {
    const view = S.runViews.get(S.shownRunId);
    if (!view) {
      clockEl.textContent = '';
      return;
    }
    const { createdAt, finishedAt } = view.run;
    if (!createdAt) {
      clockEl.textContent = '';
      return;
    }
    const end = finishedAt ?? (isFinished(view.run.status) ? createdAt : Date.now());
    clockEl.textContent = formatDuration(end - createdAt);
  }

  let lastOrder = null;
  let lastRunShown = null;

  function update() {
    const view = S.runViews.get(S.shownRunId);
    if (!view) {
      header.replaceChildren(h('p', { class: 'muted' }, '正在讀取任務…'));
      body.replaceChildren();
      signatures.clear();
      lastOrder = null;
      footer.hidden = true;
      return;
    }

    // 換到另一筆任務時，全部重畫
    if (lastRunShown !== S.shownRunId) {
      signatures.clear();
      lastOrder = null;
      lastRunShown = S.shownRunId;
    }

    const { run } = view;
    const finished = isFinished(run.status);
    patch(header, JSON.stringify([run.status, run.goal, view.cancelling, view.context?.length]), () => buildHeader(view));
    patch(costEl, JSON.stringify([run.costUsd, run.inputTokens, run.outputTokens, view.plan?.estimatedCostUsd, view.maxCostUsd]), () => buildCost(view));
    patch(planEl, JSON.stringify([view.plan?.summary, run.planSummary, finished]), () => buildPlan(view));
    patch(tasksEl, JSON.stringify([[...view.tasks.values()].map(taskSig), view.plan?.tasks]), () => buildTasks(view));
    patch(feedEl, String(view.feed.length), () => buildFeed(view));
    patch(browserEl, JSON.stringify(view.browserLog.map((e) => [e.state, e.tool, e.error])), () => buildBrowserLog(view));
    patch(resultEl, JSON.stringify([run.status, run.finalResult, run.error, [...view.tasks.values()].map((t) => [t.status, t.sources.length])]), () => buildResult(view));
    patch(artifactsEl, JSON.stringify(view.artifacts.map((a) => [a.id, a.name, a.kind, a.createdBy, a.content?.length ?? null, S.openPreviews.has(a.id ?? a.name)])), () => buildArtifacts(view));

    // 進行中先看進度；結束後把結果放最前面，不必往下捲才看得到答案
    const order = finished
      ? [resultEl, artifactsEl, costEl, planEl, tasksEl, feedEl, browserEl]
      : [planEl, costEl, tasksEl, feedEl, browserEl, resultEl, artifactsEl];
    const orderKey = finished ? 'finished' : 'running';
    if (orderKey !== lastOrder) {
      body.replaceChildren(...order);
      lastOrder = orderKey;
    }

    footer.hidden = finished;
    cancelBtn.disabled = view.cancelling;
    cancelBtn.textContent = view.cancelling ? '取消中…' : '取消任務';
    tick();
  }

  return { el, update, tick };
}

function taskSig(t) {
  return [
    t.id, t.status, t.title, t.agent, t.model, t.parentTaskId, t.position, t.error, t.startedAt, t.finishedAt,
    t.result?.length ?? 0, t.messages.length, t.fallbacks.length, t.sources.length, t.mention?.request ?? null,
  ];
}
