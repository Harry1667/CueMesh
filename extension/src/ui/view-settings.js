// 設定頁：API key、批准模式、預算、團隊模型、工作流編輯器、模型統計、外觀。
// API key 只在輸入框裡短暫存在，儲存後立刻清空，畫面上只顯示 store 回報的末四碼。
import { confirmButton, h, icon, replaceKeepingFocus } from './dom.js';
import { createAccountView } from './view-account.js';
import {
  AGENT_LABELS, formatDuration, formatUsd, moveItem, normalizeStats, parseMaxCost, PROVIDERS, validateWorkflow, workflowPayload,
} from './logic.js';

const errorText = (err) => (err instanceof Error ? err.message : String(err ?? '未知錯誤'));
const WORKFLOW_AGENTS = ['research', 'coding', '3d', 'vision', 'review', 'browser', 'planning'];

export function createSettingsView(ctx) {
  const { S, actions, catalog } = ctx;
  const account = createAccountView(ctx);
  const agents = catalog.AGENT_TYPES ? Object.keys(catalog.AGENT_TYPES) : WORKFLOW_AGENTS;
  const models = Array.isArray(catalog.MODELS) ? catalog.MODELS : [];
  const modelLabel = (ref) => {
    const id = ref.split('/').pop();
    return models.find((m) => m.id === id)?.label ?? id;
  };

  // 常用區段預設展開，進階區段預設收合
  const part = (id, title, description, { open = true } = {}, ...children) => h('details', { class: 'section', id: `settings-${id}`, open },
    h('summary', { 'data-fk': `section-${id}` }, h('h2', { class: 'part__title', id: `${id}-title` }, title), icon('chevron', 16)),
    h('div', { class: 'section__body' },
      description && h('p', { class: 'hint' }, description),
      ...children));

  // ---------- API key ----------
  const keyRows = new Map();

  function buildKeyRow(provider) {
    const status = S.keyStatus?.[provider.id];
    const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const showError = (message) => {
      error.hidden = false;
      error.textContent = message;
    };

    if (status?.set) {
      return h('div', { class: 'keyrow is-set' },
        h('span', { class: 'lamp', 'data-status': 'done', 'aria-hidden': 'true' }),
        h('div', { class: 'keyrow__info' },
          h('span', { class: 'keyrow__name' }, provider.label),
          h('span', { class: 'keyrow__mask', 'aria-label': `已設定，末四碼 ${status.last4 ?? '未知'}` }, `••••${status.last4 ?? ''}`)),
        confirmButton({
          label: '移除',
          confirmLabel: '確定？',
          className: 'btn btn--quiet btn--small',
          ariaLabel: `移除 ${provider.label} 的 API key`,
          fk: `remove-${provider.id}`,
          onConfirm: async () => {
            try {
              await actions.removeKey(provider.id);
              refreshKeyRow(provider);
            } catch (err) {
              showError(`移除失敗：${errorText(err)}`);
            }
          },
        }),
        error);
    }

    const inputId = `key-${provider.id}`;
    const input = h('input', {
      id: inputId,
      class: 'input input--mono',
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: provider.keyHint,
      'data-fk': inputId,
    });
    return h('form', {
      class: 'keyrow',
      onSubmit: async (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) {
          showError('請先貼上 API key。');
          input.focus();
          return;
        }
        try {
          await actions.saveKey(provider.id, value);
          input.value = '';
          refreshKeyRow(provider);
        } catch (err) {
          // 錯誤訊息不回顯輸入內容，避免 key 出現在畫面上
          showError(`儲存失敗：${errorText(err)}`);
        }
      },
    },
    h('span', { class: 'lamp', 'data-status': 'pending', 'aria-hidden': 'true' }),
    h('div', { class: 'keyrow__info keyrow__info--input' },
      h('label', { class: 'keyrow__name', for: inputId }, provider.label),
      h('div', { class: 'row' }, input, h('button', { type: 'submit', class: 'btn btn--ink btn--small' }, '儲存'))),
    error);
  }

  function refreshKeyRow(provider) {
    const container = keyRows.get(provider.id);
    replaceKeepingFocus(container, [buildKeyRow(provider)]);
  }

  const keysBox = h('div', { class: 'keys' }, PROVIDERS.map((provider) => {
    const container = h('div', { class: 'keyslot' });
    keyRows.set(provider.id, container);
    return container;
  }));

  // ---------- 批准模式 ----------
  const approvalOptions = [
    { id: 'always', label: '每個動作都先問我', hint: '最安全，適合第一次使用。' },
    { id: 'risky', label: '只問高風險動作', hint: '送出、付款、刪除等動作一定會問，其他自動執行。' },
  ];
  const approvalError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const approvalInputs = new Map();
  const approvalBox = h('div', { class: 'radios', role: 'radiogroup', 'aria-labelledby': 'approvalmode-title' },
    approvalOptions.map((opt) => {
      const input = h('input', {
        type: 'radio',
        name: 'approval-mode',
        value: opt.id,
        onChange: async () => {
          approvalError.hidden = true;
          try {
            await actions.updateSettings({ approvalMode: opt.id });
            actions.announce(`批准模式改為${opt.label}`);
          } catch (err) {
            approvalError.hidden = false;
            approvalError.textContent = `儲存失敗：${errorText(err)}`;
            syncFields();
          }
        },
      });
      approvalInputs.set(opt.id, input);
      return h('label', { class: 'radio' }, input, h('span', { class: 'radio__text' }, h('strong', null, opt.label), h('span', null, opt.hint)));
    }));

  // ---------- 預算 ----------
  const budgetInput = h('input', {
    id: 'budget',
    class: 'input input--mono input--short',
    type: 'number',
    inputmode: 'decimal',
    min: '0.01',
    max: '50',
    // step 必須是 any：瀏覽器會從 min 起算間距，step=0.5 時 2、5.5 這類正常數字反而被判定不合法
    step: 'any',
    'aria-describedby': 'budget-status',
  });
  const budgetStatus = h('p', { class: 'hint', id: 'budget-status' }, '超過上限時任務會自動停止。');
  const budgetForm = h('form', {
    class: 'row row--align',
    // 關掉瀏覽器原生驗證（提示語言不一定是中文），錯誤由 parseMaxCost 統一顯示
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      await saveBudget();
    },
  },
  h('label', { class: 'row__prefix', for: 'budget' }, 'US$'),
  budgetInput,
  h('button', { type: 'submit', class: 'btn btn--ink btn--small' }, '儲存'));

  async function saveBudget() {
    const parsed = parseMaxCost(budgetInput.value);
    budgetStatus.dataset.kind = parsed.error ? 'error' : 'info';
    if (parsed.error) {
      budgetStatus.textContent = parsed.error;
      return;
    }
    try {
      await actions.updateSettings({ maxCostUsd: parsed.value });
      budgetStatus.textContent = `已儲存。每次任務最多花 ${formatUsd(parsed.value)}。`;
      actions.announce('預算上限已儲存');
    } catch (err) {
      budgetStatus.dataset.kind = 'error';
      budgetStatus.textContent = `儲存失敗：${errorText(err)}`;
    }
  }

  // ---------- 團隊模型 ----------
  const teamBox = h('div', { class: 'team' });
  const teamError = h('p', { class: 'field-error', role: 'alert', hidden: true });

  function buildTeam() {
    if (models.length === 0) {
      return h('p', { class: 'muted' }, '模型目錄尚未載入。');
    }
    const byProvider = PROVIDERS.map((p) => ({ provider: p, list: models.filter((m) => m.provider === p.id) })).filter((g) => g.list.length);
    return agents.map((agent) => {
      const selectId = `team-${agent}`;
      const defaultRef = catalog.ROUTES?.[agent]?.[0];
      const select = h('select', {
        id: selectId,
        class: 'select',
        'data-fk': selectId,
        onChange: async (e) => {
          const next = { ...S.settings.teamPrefs };
          if (e.target.value) next[agent] = e.target.value;
          else delete next[agent];
          teamError.hidden = true;
          try {
            await actions.updateSettings({ teamPrefs: next });
            actions.announce(`已更新 @${agent} 的模型`);
          } catch (err) {
            teamError.hidden = false;
            teamError.textContent = `儲存失敗：${errorText(err)}`;
            renderTeam();
          }
        },
      },
      h('option', { value: '' }, defaultRef ? `自動（${modelLabel(defaultRef)}）` : '自動'),
      byProvider.map(({ provider, list }) => h('optgroup', {
        label: `${provider.label}${S.keyStatus?.[provider.id]?.set ? '' : '（未設定 key）'}`,
      }, list.map((m) => h('option', { value: `${m.provider}/${m.id}` }, m.label ?? m.name ?? m.id)))));
      select.value = S.settings.teamPrefs?.[agent] ?? '';
      return h('div', { class: 'team__row' },
        h('label', { class: 'team__agent', for: selectId },
          h('span', { class: 'tag' }, `@${agent}`),
          h('span', { class: 'team__label' }, AGENT_LABELS[agent] ?? catalog.AGENT_TYPES?.[agent]?.label ?? agent)),
        select);
    });
  }

  function renderTeam() {
    replaceKeepingFocus(teamBox, [buildTeam()]);
  }

  // ---------- 工作流 ----------
  const workflowBox = h('div', { class: 'workflows' });
  let draft = null;
  let draftError = null;
  let stepCounter = 0;
  const newStep = (step = {}) => ({ _key: `s${(stepCounter += 1)}`, title: step.title ?? '', agent: step.agent ?? 'research', instructions: step.instructions ?? '' });

  function openDraft(workflow) {
    draft = workflow
      ? { id: workflow.id, name: workflow.name, steps: (workflow.steps ?? []).map(newStep) }
      : { name: '', steps: [newStep()] };
    draftError = null;
    renderWorkflows();
    setTimeout(() => workflowBox.querySelector('[data-fk="wf-name"]')?.focus(), 30);
  }

  function buildStep(step, index) {
    const titleId = `${step._key}-title`;
    const agentId = `${step._key}-agent`;
    const instrId = `${step._key}-instr`;
    const last = draft.steps.length - 1;
    const move = (to, fk) => {
      draft.steps = moveItem(draft.steps, index, to);
      renderWorkflows();
      // 移到頂或底後，原本按的鍵會停用，焦點改放另一個方向
      const target = workflowBox.querySelector(`[data-fk="${fk}"]`);
      if (target?.disabled) workflowBox.querySelector(`[data-fk="${step._key}-${fk.endsWith('up') ? 'down' : 'up'}"]`)?.focus();
      else target?.focus();
      actions.announce(`步驟已移到第 ${to + 1} 步`);
    };
    return h('li', { class: 'step' },
      h('div', { class: 'step__head' },
        h('span', { class: 'step__no', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
        h('div', { class: 'step__tools' },
          h('button', {
            type: 'button',
            class: 'iconbtn',
            'data-fk': `${step._key}-up`,
            'aria-label': `第 ${index + 1} 步往上移`,
            disabled: index === 0,
            onClick: () => move(index - 1, `${step._key}-up`),
          }, icon('up', 14)),
          h('button', {
            type: 'button',
            class: 'iconbtn',
            'data-fk': `${step._key}-down`,
            'aria-label': `第 ${index + 1} 步往下移`,
            disabled: index === last,
            onClick: () => move(index + 1, `${step._key}-down`),
          }, icon('down', 14)),
          h('button', {
            type: 'button',
            class: 'iconbtn iconbtn--danger',
            'data-fk': `${step._key}-del`,
            'aria-label': `刪除第 ${index + 1} 步`,
            onClick: () => {
              draft.steps = draft.steps.filter((s) => s !== step);
              renderWorkflows();
              (workflowBox.querySelector('[data-fk$="-del"]') ?? workflowBox.querySelector('[data-fk="wf-add"]'))?.focus();
              actions.announce('已刪除步驟');
            },
          }, icon('close', 14)))),
      h('div', { class: 'step__fields' },
        h('label', { class: 'field', for: titleId }, h('span', null, '標題（選填）')),
        h('input', {
          id: titleId,
          class: 'input',
          type: 'text',
          maxlength: '80',
          value: step.title,
          placeholder: `步驟 ${index + 1}`,
          onInput: (e) => {
            step.title = e.target.value;
          },
        }),
        h('label', { class: 'field', for: agentId }, h('span', null, 'Agent')),
        (() => {
          const select = h('select', {
            id: agentId,
            class: 'select',
            onChange: (e) => {
              step.agent = e.target.value;
            },
          }, agents.map((a) => h('option', { value: a }, `@${a}　${AGENT_LABELS[a] ?? catalog.AGENT_TYPES?.[a]?.label ?? a}`)));
          select.value = step.agent;
          return select;
        })(),
        h('label', { class: 'field', for: instrId }, h('span', null, '指示')),
        h('textarea', {
          id: instrId,
          class: 'input input--area',
          rows: '3',
          value: step.instructions,
          placeholder: '這一步要完成什麼',
          onInput: (e) => {
            step.instructions = e.target.value;
          },
        })));
  }

  function buildEditor() {
    return h('form', {
      class: 'wf-editor',
      'aria-label': draft.id ? '編輯工作流' : '新增工作流',
      onSubmit: async (e) => {
        e.preventDefault();
        draftError = validateWorkflow(draft);
        if (draftError) {
          renderWorkflows();
          return;
        }
        try {
          await actions.saveWorkflow(workflowPayload(draft));
          draft = null;
          draftError = null;
          actions.announce('工作流已儲存');
        } catch (err) {
          draftError = `儲存失敗：${errorText(err)}`;
        }
        renderWorkflows();
      },
    },
    h('label', { class: 'field', for: 'wf-name' }, h('span', null, '工作流名稱')),
    h('input', {
      id: 'wf-name',
      class: 'input',
      type: 'text',
      maxlength: '60',
      value: draft.name,
      'data-fk': 'wf-name',
      placeholder: '例如：競品週報',
      onInput: (e) => {
        draft.name = e.target.value;
      },
    }),
    h('ol', { class: 'steps' }, draft.steps.map(buildStep)),
    h('button', {
      type: 'button',
      class: 'btn btn--quiet btn--block',
      'data-fk': 'wf-add',
      onClick: () => {
        const step = newStep();
        draft.steps = [...draft.steps, step];
        renderWorkflows();
        document.getElementById(`${step._key}-instr`)?.focus();
      },
    }, icon('plus', 14), '新增步驟'),
    draftError && h('p', { class: 'field-error', role: 'alert' }, draftError),
    h('div', { class: 'row row--end' },
      h('button', {
        type: 'button',
        class: 'btn btn--quiet',
        onClick: () => {
          draft = null;
          draftError = null;
          renderWorkflows();
        },
      }, '放棄'),
      h('button', { type: 'submit', class: 'btn btn--ink' }, '儲存工作流')));
  }

  function buildWorkflowList() {
    const listError = h('p', { class: 'field-error', role: 'alert', hidden: true });
    return [
      S.workflows.length
        ? h('ul', { class: 'wf-list' }, S.workflows.map((workflow) => h('li', { class: 'wf-item' },
          h('div', { class: 'wf-item__info' },
            h('span', { class: 'wf-item__name' }, workflow.name),
            h('span', { class: 'wf-item__steps' }, (workflow.steps ?? []).map((s) => `@${s.agent}`).join(' → ') || '沒有步驟')),
          h('div', { class: 'wf-item__actions' },
            h('button', {
              type: 'button',
              class: 'btn btn--quiet btn--small',
              'aria-label': `編輯工作流 ${workflow.name}`,
              onClick: () => openDraft(workflow),
            }, '編輯'),
            confirmButton({
              label: '刪除',
              confirmLabel: '確定？',
              className: 'btn btn--quiet btn--small',
              ariaLabel: `刪除工作流 ${workflow.name}`,
              onConfirm: async () => {
                try {
                  await actions.deleteWorkflow(workflow.id);
                  renderWorkflows();
                } catch (err) {
                  listError.hidden = false;
                  listError.textContent = `刪除失敗：${errorText(err)}`;
                }
              },
            })))))
        : h('p', { class: 'muted' }, '還沒有工作流。把常做的流程存起來，下次一鍵執行。'),
      listError,
      h('button', { type: 'button', class: 'btn btn--quiet btn--block', 'data-fk': 'wf-new', onClick: () => openDraft(null) }, icon('plus', 14), '新增工作流'),
    ];
  }

  function renderWorkflows() {
    replaceKeepingFocus(workflowBox, draft ? [buildEditor()] : buildWorkflowList());
  }

  // ---------- 統計 ----------
  const statsBox = h('div', { class: 'stats' });

  async function renderStats() {
    statsBox.replaceChildren(h('p', { class: 'muted' }, '讀取中…'));
    try {
      const rows = normalizeStats(await actions.getStats());
      if (rows.length === 0) {
        statsBox.replaceChildren(h('p', { class: 'muted' }, '還沒有資料。跑過任務後，這裡會顯示各模型的實際表現。'));
        return;
      }
      statsBox.replaceChildren(h('div', { class: 'stats__scroll', tabindex: '0', role: 'region', 'aria-label': '模型表現統計表' },
        h('table', { class: 'stats__table' },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col' }, '模型與工作'),
            h('th', { scope: 'col' }, '成功率'),
            h('th', { scope: 'col', class: 'align-right' }, '平均'),
            h('th', { scope: 'col', class: 'align-right' }, '費用'))),
          h('tbody', null, rows.map((row) => {
            const bar = h('span', { class: 'stats__bar-fill' });
            bar.style.width = `${Math.round((row.rate ?? 0) * 100)}%`;
            return h('tr', null,
              h('td', null,
                h('span', { class: 'stats__model' }, row.model),
                row.agent && h('span', { class: 'stats__agent' }, `@${row.agent}`)),
              h('td', null,
                h('span', { class: 'stats__rate' }, row.rate === null ? '—' : `${Math.round(row.rate * 100)}%`),
                h('span', { class: 'stats__bar', 'aria-hidden': 'true' }, bar),
                h('span', { class: 'stats__count' }, `${row.successes} 成功／${row.failures} 失敗`)),
              h('td', { class: 'align-right stats__num' }, row.avgMs === null ? '—' : formatDuration(row.avgMs)),
              h('td', { class: 'align-right stats__num' }, formatUsd(row.costUsd)));
          })))));
    } catch (err) {
      statsBox.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, `讀取統計失敗：${errorText(err)}`));
    }
  }

  // ---------- 外觀 ----------
  const themeInputs = new Map();
  const themeBox = h('div', { class: 'modes', role: 'radiogroup', 'aria-labelledby': 'theme-title' },
    [['system', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([id, label]) => {
      const input = h('input', { type: 'radio', name: 'theme', value: id, class: 'modes__input', onChange: () => actions.setTheme(id) });
      themeInputs.set(id, input);
      return h('label', { class: 'modes__item' }, input, h('span', { class: 'modes__label' }, label));
    }));

  const el = h('div', { class: 'view view--settings' },
    h('h2', { class: 'view-title' }, '設定'),
    part('account', '帳號與裝置', null, {}, account.accountEl),
    part('keys', 'API key', 'key 只存在這個瀏覽器，不會傳給 CueMesh 網站，儲存後只顯示末四碼。瀏覽器的儲存空間沒有加密，請不要在共用電腦上使用。', {}, keysBox, account.vaultEl),
    part('limits', '批准與預算', null, {},
      h('h3', { class: 'subhead', id: 'approvalmode-title' }, '批准模式'),
      h('p', { class: 'hint' }, '密碼與付款欄位一律由你親自輸入，不受這裡影響。'),
      approvalBox,
      approvalError,
      h('h3', { class: 'subhead' }, '每次任務的預算上限'),
      budgetForm,
      budgetStatus),
    part('team', '團隊模型', '指定每個 agent 優先用哪個模型。失敗或沒有 key 時會自動換下一個。', { open: false }, teamBox, teamError),
    part('workflows', '工作流', '把固定的步驟存起來，在任務頁選「工作流」執行。', { open: false }, workflowBox),
    part('stats', '表現統計', '只統計你自己的任務，費用為依公開牌價的估算。', { open: false }, statsBox),
    part('theme', '外觀', null, { open: false }, themeBox));

  function syncFields() {
    for (const [id, input] of approvalInputs) input.checked = S.settings.approvalMode === id;
    if (document.activeElement !== budgetInput) budgetInput.value = String(S.settings.maxCostUsd ?? '');
    for (const [id, input] of themeInputs) input.checked = S.themePref === id;
  }

  let lastKeySig = null;
  let lastWorkflowSig = null;

  function update(justShown) {
    account.update(justShown);
    const keySig = JSON.stringify(S.keyStatus);
    if (justShown || keySig !== lastKeySig) {
      lastKeySig = keySig;
      for (const provider of PROVIDERS) {
        const container = keyRows.get(provider.id);
        const typing = container.querySelector('input')?.value;
        // 使用者正在輸入 key 時不要重建，否則內容會被清掉
        if (!typing) refreshKeyRow(provider);
      }
      if (!justShown) renderTeam();
    }
    syncFields();
    const workflowSig = JSON.stringify(S.workflows);
    if (workflowSig !== lastWorkflowSig && !draft) {
      lastWorkflowSig = workflowSig;
      renderWorkflows();
    }
    if (justShown) {
      renderTeam();
      if (!draft) renderWorkflows();
      renderStats();
    }
  }

  return {
    el,
    update,
    focusSection(id) {
      const target = el.querySelector(`#settings-${id}`);
      if (!target) return;
      target.open = true;
      target.scrollIntoView({ block: 'start' });
      const field = [...target.querySelectorAll('input:not([type=radio]), button')].find((node) => node.offsetParent !== null);
      (field ?? target.querySelector('summary'))?.focus();
    },
  };
}
