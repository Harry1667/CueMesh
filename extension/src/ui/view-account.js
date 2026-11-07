// 帳號頁：登入註冊、伺服器、裝置、金鑰同步、專案成員。
// 沒登入時所有單機功能照常可用，這裡只是多一個選項。
// 密碼與密語只存在輸入框，送出後立刻清空，不放進任何狀態。
import { confirmButton, h, icon, replaceKeepingFocus } from './dom.js';
import {
  ACCEPT_REMOTE_OPTIONS, canRemoveMember, CLOUD_STATUS, clip, deviceLabel, deviceOwner, validateCredentials,
  validatePassphrase, validateServerUrl,
} from './logic.js';

const errorText = (err) => (err instanceof Error ? err.message : String(err ?? '未知錯誤'));
const dateFormat = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const when = (ms) => (ms ? dateFormat.format(new Date(ms)) : '時間不明');
const fieldError = () => h('p', { class: 'field-error', role: 'alert', hidden: true });
const showError = (el, message) => {
  el.hidden = !message;
  el.textContent = message ?? '';
};

export function createAccountView({ S, actions, cloud }) {
  // 帳號內的小區塊；金鑰與成員預設收合，保持設定頁精簡
  const block = (id, title, description, ...children) => h('div', { id: `account-${id}` },
    h('h3', { class: 'subhead' }, title),
    description && h('p', { class: 'hint' }, description),
    ...children);
  const collapsible = (id, title, description, ...children) => h('details', { class: 'sub-section', id: `account-${id}` },
    h('summary', null, h('span', null, title), icon('chevron', 16)),
    description && h('p', { class: 'hint' }, description),
    ...children);

  if (!cloud) {
    return {
      accountEl: h('p', { class: 'muted' }, S.cloudLoadError
        ? `雲端模組無法載入：${S.cloudLoadError}。任務功能不受影響。`
        : '這個版本沒有雲端模組。任務功能不受影響。'),
      vaultEl: null,
      update() {},
    };
  }

  // ---------- 狀態 ----------
  const statusEl = h('p', { class: 'account-status', role: 'status' });

  // ---------- 伺服器 ----------
  const serverInput = h('input', { id: 'server-url', class: 'input input--mono', type: 'url', inputmode: 'url', spellcheck: 'false', placeholder: 'https://cuemesh.example.com' });
  const serverNote = h('p', { class: 'hint', id: 'server-note' });
  const serverForm = h('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const parsed = validateServerUrl(serverInput.value);
      serverNote.dataset.kind = parsed.error ? 'error' : parsed.warning ? 'warning' : 'info';
      if (parsed.error) {
        serverNote.textContent = parsed.error;
        return;
      }
      try {
        await actions.setServerUrl(parsed.url);
        serverNote.textContent = parsed.warning ?? '已儲存。';
      } catch (err) {
        serverNote.dataset.kind = 'error';
        serverNote.textContent = `儲存失敗：${errorText(err)}`;
      }
    },
  },
  h('label', { class: 'field', for: 'server-url' }, h('span', null, '伺服器網址')),
  h('div', { class: 'row' }, serverInput, h('button', { type: 'submit', class: 'btn btn--ink btn--small' }, '儲存')),
  serverNote);

  // ---------- 登入與註冊 ----------
  let authMode = 'login';
  const emailInput = h('input', { id: 'auth-email', class: 'input', type: 'email', autocomplete: 'email', spellcheck: 'false' });
  const passwordInput = h('input', { id: 'auth-password', class: 'input', type: 'password', autocomplete: 'current-password' });
  const nameInput = h('input', { id: 'auth-name', class: 'input', type: 'text', maxlength: '60', autocomplete: 'name' });
  const nameRow = h('div', { hidden: true }, h('label', { class: 'field', for: 'auth-name' }, h('span', null, '顯示名稱（其他成員會看到）')), nameInput);
  const passwordHint = h('p', { class: 'hint', hidden: true }, '至少 10 個字元。');
  const authError = fieldError();
  const authSubmit = h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, '登入');
  const authTabs = new Map();
  const setAuthMode = (mode) => {
    authMode = mode;
    for (const [id, input] of authTabs) input.checked = id === mode;
    nameRow.hidden = mode !== 'register';
    passwordHint.hidden = mode !== 'register';
    passwordInput.setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    authSubmit.textContent = mode === 'register' ? '註冊並登入' : '登入';
    showError(authError, null);
  };
  const authModes = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': '登入或註冊' },
    [['login', '登入'], ['register', '註冊']].map(([id, label]) => {
      const input = h('input', { type: 'radio', name: 'auth-mode', value: id, class: 'modes__input', checked: id === 'login', onChange: () => setAuthMode(id) });
      authTabs.set(id, input);
      return h('label', { class: 'modes__item' }, input, h('span', { class: 'modes__label' }, label));
    }));
  const authForm = h('form', {
    novalidate: true,
    class: 'auth-form',
    onSubmit: async (e) => {
      e.preventDefault();
      const input = { mode: authMode, email: emailInput.value.trim(), password: passwordInput.value, displayName: nameInput.value.trim() };
      const invalid = validateCredentials(input);
      showError(authError, invalid);
      if (invalid) return;
      // 使用者常常填了網址就直接按登入，先把還沒儲存的網址存起來
      const typedUrl = serverInput.value.trim();
      const server = validateServerUrl(typedUrl);
      if (!typedUrl || server.error) {
        showError(authError, typedUrl ? server.error : '請先在下方填寫伺服器網址。');
        passwordInput.value = '';
        serverInput.focus();
        return;
      }
      authSubmit.disabled = true;
      try {
        if (server.url !== S.cloudState.baseUrl) await actions.setServerUrl(server.url);
        await actions.authenticate(input);
        emailInput.value = '';
        nameInput.value = '';
      } catch (err) {
        showError(authError, errorText(err));
      } finally {
        // 不論成功或失敗，密碼都不留在畫面上
        passwordInput.value = '';
        authSubmit.disabled = false;
      }
    },
  },
  authModes,
  nameRow,
  h('label', { class: 'field', for: 'auth-email' }, h('span', null, '電子郵件')),
  emailInput,
  h('label', { class: 'field', for: 'auth-password' }, h('span', null, '密碼')),
  passwordInput,
  passwordHint,
  authError,
  authSubmit);

  const signedOutBox = h('div', null,
    h('p', { class: 'hint', id: 'account-login-note' }, '登入後可以派工給其他裝置、共享專案、同步 API key。不登入也能用所有單機功能。'),
    h('div', { id: 'account-login' }, authForm),
    h('div', { id: 'account-server' }, serverForm));

  // ---------- 使用者 ----------
  const userBox = h('div', { class: 'account-user' });
  const logoutBtn = h('button', { type: 'button', class: 'btn btn--small', onClick: () => actions.logout() }, '登出');

  // ---------- 裝置 ----------
  const deviceNameInput = h('input', { id: 'device-name', class: 'input', type: 'text', maxlength: '60' });
  const deviceNote = h('p', { class: 'hint', hidden: true });
  const deviceForm = h('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const name = deviceNameInput.value.trim();
      deviceNote.hidden = false;
      deviceNote.dataset.kind = name ? 'info' : 'error';
      if (!name) {
        deviceNote.textContent = '請輸入裝置名稱。';
        return;
      }
      try {
        await actions.renameDevice(name);
        deviceNote.textContent = '已儲存。';
      } catch (err) {
        deviceNote.dataset.kind = 'error';
        deviceNote.textContent = `儲存失敗：${errorText(err)}`;
      }
    },
  },
  h('label', { class: 'field', for: 'device-name' }, h('span', null, '這台裝置的名稱')),
  h('div', { class: 'row' }, deviceNameInput, h('button', { type: 'submit', class: 'btn btn--ink btn--small' }, '儲存')),
  deviceNote);

  const acceptError = fieldError();
  const acceptInputs = new Map();
  const acceptBox = h('div', { class: 'radios', role: 'radiogroup', 'aria-labelledby': 'accept-title' },
    ACCEPT_REMOTE_OPTIONS.map((opt) => {
      const input = h('input', {
        type: 'radio',
        name: 'accept-remote',
        value: opt.id,
        onChange: async () => {
          showError(acceptError, null);
          try {
            await actions.setAcceptRemote(opt.id);
            actions.announce(`派工設定改為${opt.label}`);
          } catch (err) {
            showError(acceptError, `儲存失敗：${errorText(err)}`);
            syncDevice();
          }
        },
      });
      acceptInputs.set(opt.id, input);
      return h('label', { class: 'radio' }, input, h('span', { class: 'radio__text' }, h('strong', null, opt.label), h('span', null, opt.risk)));
    }));

  const devicesBox = h('div');
  function buildDevices() {
    if (S.cloudState.devicesError) return h('p', { class: 'field-error', role: 'alert' }, S.cloudState.devicesError);
    const devices = S.cloudState.devices;
    if (devices.length === 0) return h('p', { class: 'muted' }, '目前只有這台裝置。');
    const thisId = S.cloudState.device?.id;
    return h('ul', { class: 'device-list' }, devices.map((d) => {
      const owner = deviceOwner(d);
      const accept = ACCEPT_REMOTE_OPTIONS.find((o) => o.id === d.acceptRemote)?.label;
      return h('li', { class: 'device' },
        h('span', { class: 'lamp', 'data-status': d.online ? 'done' : 'off', 'aria-hidden': 'true' }),
        h('span', { class: 'device__body' },
          h('span', { class: 'device__name' },
            deviceLabel(d) ?? '未命名裝置',
            d.id === thisId && h('span', { class: 'tag device__this' }, '這台')),
          h('span', { class: 'device__meta' },
            [d.online ? '線上' : '離線', owner ? `${owner}的裝置` : null, accept].filter(Boolean).join('・'))));
    }));
  }

  // ---------- 金鑰同步 ----------
  const vaultStatusEl = h('p', { class: 'hint' });
  const passInput = h('input', { id: 'vault-pass', class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false' });
  const passConfirm = h('input', { id: 'vault-confirm', class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false' });
  const vaultError = fieldError();
  const vaultDone = h('p', { class: 'hint', role: 'status', hidden: true });
  let vaultBusy = false;
  const clearPassphrase = () => {
    passInput.value = '';
    passConfirm.value = '';
  };

  async function runVault(action) {
    if (vaultBusy) return;
    const passphrase = passInput.value;
    const invalid = validatePassphrase({ action, passphrase, confirm: passConfirm.value });
    showError(vaultError, invalid);
    vaultDone.hidden = true;
    if (invalid) {
      clearPassphrase();
      passInput.focus();
      return;
    }
    // 先從畫面清掉，操作中也不留在輸入框
    clearPassphrase();
    vaultBusy = true;
    paintVaultButtons();
    try {
      if (action === 'push') await actions.vaultPush(passphrase);
      else await actions.vaultPull(passphrase);
      vaultDone.hidden = false;
      vaultDone.textContent = action === 'push' ? '已加密上傳。伺服器只有密文，解不開。' : '已下載並解密，這台裝置的 API key 已更新。';
    } catch (err) {
      showError(vaultError, errorText(err));
    } finally {
      vaultBusy = false;
      paintVaultButtons();
    }
  }

  const pullBtn = h('button', { type: 'button', class: 'btn btn--quiet', onClick: () => runVault('pull') }, icon('down', 14), '下載到這台');
  const pushSlot = h('span', { class: 'vault__push' });
  function paintVaultButtons() {
    pullBtn.disabled = vaultBusy || !S.cloudState.vault?.exists;
    const button = S.cloudState.vault?.exists
      ? confirmButton({ label: '上傳並覆蓋', confirmLabel: '確定覆蓋？', className: 'btn btn--ink', onConfirm: () => runVault('push') })
      : h('button', { type: 'button', class: 'btn btn--ink', onClick: () => runVault('push') }, icon('up', 14), '上傳');
    button.disabled = vaultBusy;
    pushSlot.replaceChildren(button);
  }
  const vaultForm = h('form', {
    novalidate: true,
    onSubmit: (e) => e.preventDefault(),
  },
  h('label', { class: 'field', for: 'vault-pass' }, h('span', null, '密語')),
  passInput,
  h('label', { class: 'field', for: 'vault-confirm' }, h('span', null, '再輸入一次（上傳時需要）')),
  passConfirm,
  vaultError,
  h('div', { class: 'row row--wrap vault__actions' }, pushSlot, pullBtn),
  vaultDone);
  const vaultWarning = h('div', { class: 'warning-box' },
    h('strong', null, '密語無法找回'),
    h('p', null, '伺服器只存密文，忘記密語就只能重新輸入每一把 API key。密語不會離開這台裝置，也不能和登入密碼相同。'));

  // ---------- 專案成員 ----------
  const projectName = h('p', { class: 'member-project' });
  const inviteBox = h('div');
  const inviteError = fieldError();
  const membersBox = h('div');
  const memberError = fieldError();
  const codeInput = h('input', { id: 'invite-code', class: 'input input--mono', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '貼上別人給你的邀請碼' });
  const joinNote = h('p', { class: 'hint', role: 'status', hidden: true });
  const joinForm = h('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      const code = codeInput.value.trim();
      joinNote.hidden = false;
      joinNote.dataset.kind = code ? 'info' : 'error';
      if (!code) {
        joinNote.textContent = '請先貼上邀請碼。';
        return;
      }
      try {
        const name = await actions.acceptInvite(code);
        codeInput.value = '';
        joinNote.textContent = `已加入專案「${clip(name, 40)}」。`;
      } catch (err) {
        joinNote.dataset.kind = 'error';
        joinNote.textContent = `加入失敗：${errorText(err)}`;
      }
    },
  },
  h('label', { class: 'field', for: 'invite-code' }, h('span', null, '加入別人的專案')),
  h('div', { class: 'row' }, codeInput, h('button', { type: 'submit', class: 'btn btn--ink btn--small' }, '加入')),
  joinNote);

  function buildInvite() {
    const project = S.projects.find((p) => p.id === S.projectId);
    if (project?.role === 'member') return h('p', { class: 'muted' }, '只有專案擁有者可以產生邀請碼。');
    const invite = S.cloudState.invite?.projectId === S.projectId ? S.cloudState.invite : null;
    return h('div', { class: 'invite' },
      h('button', {
        type: 'button',
        class: 'btn btn--quiet btn--block',
        'data-fk': 'invite-create',
        onClick: async () => {
          showError(inviteError, null);
          try {
            await actions.createInvite();
          } catch (err) {
            showError(inviteError, `無法產生邀請碼：${errorText(err)}`);
          }
        },
      }, icon('plus', 14), invite ? '重新產生邀請碼' : '產生邀請碼'),
      invite && h('div', { class: 'invite__code' },
        h('code', { class: 'invite__value' }, invite.code),
        h('button', {
          type: 'button',
          class: 'iconbtn iconbtn--label',
          'data-fk': 'invite-copy',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(invite.code);
              actions.notify('已複製邀請碼', 'info');
            } catch (err) {
              actions.notify(`無法複製：${err.message}`);
            }
          },
        }, icon('copy', 14), '複製')),
      invite && h('p', { class: 'hint' }, `只能用一次，${when(invite.expiresAt)} 到期。對方加入後可以派工到你的裝置，也會看到這個專案的任務。`));
  }

  function buildMembers() {
    if (S.cloudState.membersError) return h('p', { class: 'muted' }, S.cloudState.membersError);
    const members = S.cloudState.members;
    if (members.length === 0) return h('p', { class: 'muted' }, '還沒有其他成員。');
    const myUserId = S.cloudState.user?.id;
    const myRole = members.find((m) => m.userId === myUserId)?.role;
    return h('ul', { class: 'member-list' }, members.map((m) => h('li', { class: 'member' },
      h('span', { class: 'member__body' },
        h('span', { class: 'member__name' }, m.displayName || m.email || '未命名成員', m.userId === myUserId && h('span', { class: 'tag device__this' }, '你')),
        h('span', { class: 'member__meta' }, `${m.role === 'owner' ? '擁有者' : '成員'}${m.email ? `・${m.email}` : ''}`)),
      canRemoveMember({ member: m, myUserId, myRole }) && confirmButton({
        label: m.userId === myUserId ? '退出' : '移除',
        confirmLabel: '確定？',
        className: 'btn btn--quiet btn--small',
        ariaLabel: m.userId === myUserId ? '退出這個專案' : `移除成員 ${m.displayName || m.email || ''}`,
        onConfirm: async () => {
          showError(memberError, null);
          try {
            await actions.removeMember(m.userId);
          } catch (err) {
            showError(memberError, `移除失敗：${errorText(err)}`);
          }
        },
      }))));
  }

  const signedInBox = h('div', null,
    h('div', { id: 'account-user' }, userBox),
    h('p', { class: 'muted account-server' }, ''),
    h('div', { id: 'account-device' }, deviceForm,
      h('h3', { class: 'subhead', id: 'accept-title' }, '是否接受派工'),
      h('p', { class: 'hint' }, '接受派工代表別人的 agent 會用這個瀏覽器（看得到你登入的網站）和你的 API key。'),
      acceptBox,
      acceptError,
      h('h3', { class: 'subhead' }, '所有裝置'),
      devicesBox),
    collapsible('members', '專案成員', null, projectName, inviteBox, inviteError, h('h3', { class: 'subhead' }, '成員'), membersBox, memberError, joinForm));

  // 金鑰同步放在 API key 區段底下，由設定頁決定位置；未登入時不顯示
  const vaultEl = collapsible('vault', '金鑰同步', '把 API key 用密語加密後存到雲端，換裝置時下載。', vaultWarning, vaultStatusEl, vaultForm);

  const accountEl = h('div', { class: 'view--account' }, statusEl, signedOutBox, signedInBox);

  const signatures = new Map();
  const patch = (container, signature, build) => {
    if (signatures.get(container) === signature) return;
    signatures.set(container, signature);
    replaceKeepingFocus(container, [build()]);
  };

  function syncDevice() {
    const device = S.cloudState.device;
    for (const [id, input] of acceptInputs) input.checked = (device?.acceptRemote ?? 'ask') === id;
    if (document.activeElement !== deviceNameInput) deviceNameInput.value = device?.name ?? '';
  }

  function update(justShown) {
    const { user, status } = S.cloudState;
    const info = CLOUD_STATUS[status] ?? CLOUD_STATUS.signed_out;
    statusEl.replaceChildren(h('span', { class: 'lamp', 'data-status': info.lamp, 'aria-hidden': 'true' }), h('span', null, info.label));
    signedOutBox.hidden = Boolean(user);
    signedInBox.hidden = !user;
    vaultEl.hidden = !user;
    if (document.activeElement !== serverInput && (justShown || !serverInput.value)) serverInput.value = S.cloudState.baseUrl ?? '';

    if (!user) return;
    patch(userBox, JSON.stringify([user.displayName, user.email]), () => h('div', { class: 'account-user__row' },
      h('span', { class: 'account-user__body' },
        h('strong', null, user.displayName || user.email || '已登入'),
        user.email && h('span', { class: 'muted' }, user.email)),
      logoutBtn));
    const serverLabel = signedInBox.querySelector('.account-server');
    serverLabel.textContent = S.cloudState.baseUrl ? `目前連到 ${S.cloudState.baseUrl}。要換伺服器請先登出。` : '';
    syncDevice();
    patch(devicesBox, JSON.stringify([S.cloudState.devices, S.cloudState.devicesError, S.cloudState.device?.id]), buildDevices);

    const vault = S.cloudState.vault;
    vaultStatusEl.textContent = S.cloudState.vaultError
      ?? (vault?.exists ? `雲端已有備份，更新於 ${when(vault.updatedAt)}。` : '雲端還沒有備份。');
    const vaultSig = JSON.stringify([vault?.exists, vaultBusy]);
    if (signatures.get(pushSlot) !== vaultSig) {
      signatures.set(pushSlot, vaultSig);
      paintVaultButtons();
    }

    const project = S.projects.find((p) => p.id === S.projectId);
    projectName.textContent = project ? `目前專案：${project.name}` : '還沒有專案';
    patch(inviteBox, JSON.stringify([S.projectId, project?.role, S.cloudState.invite]), buildInvite);
    patch(membersBox, JSON.stringify([S.cloudState.members, S.cloudState.membersError, user.id]), buildMembers);
  }

  return { accountEl, vaultEl, update };
}
