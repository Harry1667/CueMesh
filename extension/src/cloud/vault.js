// 端對端金鑰保險箱：只使用瀏覽器 WebCrypto，密語不會離開呼叫函式。

// CueMesh 目前只支援 Anthropic 與 OpenAI，保險箱格式也只接受這兩把 key。
export const VAULT_PROVIDERS = ['anthropic', 'openai'];
export const VAULT_ITERATIONS = 600000;

export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultError';
  }
}

function cryptoOrThrow(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) {
    throw new VaultError('目前瀏覽器不支援安全的金鑰保險箱');
  }
  return cryptoImpl;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateKeyBundle(value) {
  if (!plainObject(value)) throw new VaultError('保險箱資料格式無效');
  const names = Object.keys(value).sort();
  if (names.length !== VAULT_PROVIDERS.length || names.some((name, index) => name !== [...VAULT_PROVIDERS].sort()[index])) {
    throw new VaultError('保險箱資料格式無效');
  }

  const bundle = {};
  for (const provider of VAULT_PROVIDERS) {
    const key = value[provider];
    if (key !== null && (typeof key !== 'string' || !key.trim() || key.length > 10000)) {
      throw new VaultError('保險箱資料格式無效');
    }
    bundle[provider] = key;
  }
  return bundle;
}

export function toBase64(bytes) {
  let text = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(text);
}

export function fromBase64(value) {
  if (typeof value !== 'string' || !value) throw new VaultError('保險箱資料格式無效');
  try {
    const text = globalThis.atob(value);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return bytes;
  } catch {
    throw new VaultError('保險箱資料格式無效');
  }
}

async function deriveAesKey(passphrase, salt, cryptoImpl) {
  if (typeof passphrase !== 'string' || !passphrase) throw new VaultError('請輸入保險箱密語');
  const passwordBytes = new TextEncoder().encode(passphrase);
  try {
    const material = await cryptoImpl.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    return await cryptoImpl.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_ITERATIONS },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    passwordBytes.fill(0);
  }
}

function validateVaultEnvelope(vault) {
  if (!plainObject(vault) || !plainObject(vault.kdf)) throw new VaultError('保險箱資料格式無效');
  if (vault.kdf.name !== 'PBKDF2' || vault.kdf.hash !== 'SHA-256' || vault.kdf.iterations !== VAULT_ITERATIONS) {
    throw new VaultError('保險箱資料格式無效');
  }
  if (typeof vault.salt !== 'string' || typeof vault.iv !== 'string' || typeof vault.ciphertext !== 'string') {
    throw new VaultError('保險箱資料格式無效');
  }
}

export async function encryptKeyBundle(keys, passphrase, { cryptoImpl } = {}) {
  const cryptoApi = cryptoOrThrow(cryptoImpl);
  const bundle = validateKeyBundle(keys);
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const plainBytes = new TextEncoder().encode(JSON.stringify(bundle));
  try {
    const key = await deriveAesKey(passphrase, salt, cryptoApi);
    const ciphertext = new Uint8Array(await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes));
    return {
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_ITERATIONS },
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
    };
  } finally {
    plainBytes.fill(0);
  }
}

export async function decryptKeyBundle(vault, passphrase, { cryptoImpl } = {}) {
  const cryptoApi = cryptoOrThrow(cryptoImpl);
  validateVaultEnvelope(vault);
  const salt = fromBase64(vault.salt);
  const iv = fromBase64(vault.iv);
  const ciphertext = fromBase64(vault.ciphertext);
  let plainBytes;
  try {
    const key = await deriveAesKey(passphrase, salt, cryptoApi);
    plainBytes = new Uint8Array(await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
    const decoded = new TextDecoder().decode(plainBytes);
    return validateKeyBundle(JSON.parse(decoded));
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError('保險箱密語錯誤或資料已損毀');
  } finally {
    plainBytes?.fill(0);
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}
