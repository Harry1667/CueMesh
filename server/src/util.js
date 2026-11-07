import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};

export function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function jsonError(response, error) {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ error: { code: 'internal_error', message: '伺服器發生未預期錯誤' } });
}

export function newId() {
  return randomBytes(18).toString('base64url');
}

export function opaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, expected] = String(encoded ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  const actual = Buffer.from(derived).toString('base64url');
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireObject(value, label = '請求內容') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_input', `${label}必須是物件`);
  return value;
}

export function requireString(value, label, { min = 1, max = 10_000, trim = true } = {}) {
  if (typeof value !== 'string') fail(400, 'invalid_input', `${label}必須是字串`);
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) fail(400, 'invalid_input', `${label}長度不符合限制`);
  return result;
}

export function optionalString(value, label, options = {}) {
  if (value === undefined || value === null) return null;
  return requireString(value, label, options);
}

export function requireId(value, label = 'ID') {
  return requireString(value, label, { min: 1, max: 160 });
}

export function requireFiniteNumber(value, label, { min = -Number.MAX_VALUE, max = Number.MAX_VALUE } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(400, 'invalid_input', `${label}必須是有效數字`);
  }
  return value;
}

export function normalizedEmail(value) {
  const email = requireString(value, 'Email', { min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'invalid_input', 'Email 格式不正確');
  return email;
}

export function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function assertNoSensitiveFields(value) {
  const forbidden = /(api[_-]?key|screenshot|screen[_-]?shot)/i;
  const walk = (item) => {
    if (Array.isArray(item)) return item.forEach(walk);
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.test(key)) fail(400, 'invalid_input', '不可上傳 API key 或截圖');
      walk(child);
    }
  };
  walk(value);
}

export function isBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 === 1) return false;
  return /^(?:[A-Za-z0-9+/]*={0,2})$/.test(value);
}

export function parseJson(value, fallback = null) {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function stateError(message = '目前狀態不允許這個操作') {
  fail(409, 'invalid_state', message);
}

export function notFound() {
  fail(404, 'not_found', '找不到資源');
}

export function forbidden(message = '你沒有執行這個操作的權限') {
  fail(403, 'forbidden', message);
}

export function unauthorized() {
  fail(401, 'unauthorized', '登入已失效或尚未登入');
}
