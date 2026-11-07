import express from 'express';
import {
  ApiError,
  assertNoSensitiveFields,
  asyncRoute,
  fail,
  forbidden,
  hashPassword,
  isBase64,
  jsonByteLength,
  jsonError,
  newId,
  normalizedEmail,
  notFound,
  opaqueToken,
  optionalString,
  parseJson,
  requireFiniteNumber,
  requireId,
  requireObject,
  requireString,
  stateError,
  tokenHash,
  unauthorized,
  verifyPassword,
} from './util.js';
import { createDatabase, transaction } from './database.js';

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_VAULT_BYTES = 64 * 1024;
const DISPATCH_EXPIRY_MS = 10 * 60 * 1000;
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL_DISPATCH_STATES = new Set(['rejected', 'done', 'partial', 'failed', 'cancelled', 'expired']);
const RUN_STATUSES = new Set(['planning', 'running', 'done', 'partial', 'failed', 'cancelled']);
const RUN_MODES = new Set(['auto', 'council', 'workflow']);
const TASK_STATUSES = new Set(['pending', 'running', 'done', 'failed']);
const TASK_AGENTS = new Set(['research', 'coding', '3d', 'vision', 'planning', 'review', 'browser']);
const ARTIFACT_KINDS = new Set(['html', 'code', 'markdown', 'data']);
const MESSAGE_KINDS = new Set(['question', 'answer', 'progress']);

export function canTransitionDispatch(from, to) {
  return (from === 'pending' && ['accepted', 'rejected', 'cancelled', 'expired'].includes(to))
    || (from === 'accepted' && ['done', 'partial', 'failed', 'cancelled'].includes(to));
}

function userJson(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

function projectJson(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    ...(row.role ? { role: row.role } : {}),
  };
}

function deviceJson(row, online, currentUserId) {
  return {
    id: row.id,
    userId: row.user_id,
    ownerName: row.owner_name,
    name: row.name,
    platform: row.platform,
    acceptRemote: row.accept_remote,
    online,
    lastSeenAt: row.last_seen_at,
    mine: row.user_id === currentUserId,
  };
}

function runJson(row, { full = false } = {}) {
  const output = {
    id: row.id,
    projectId: row.project_id,
    goal: row.goal,
    status: row.status,
    mode: row.mode,
    planSummary: row.plan_summary,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    deviceId: row.device_id,
  };
  if (full) {
    output.finalResult = row.final_result;
    output.error = row.error;
  }
  return output;
}

function taskJson(row) {
  return {
    id: row.id,
    runId: row.run_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    agent: row.agent,
    status: row.status,
    provider: row.provider,
    model: row.model,
    result: row.result,
    sources: parseJson(row.sources_json, []),
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function artifactJson(row) {
  return {
    id: row.id,
    runId: row.run_id,
    name: row.name,
    kind: row.kind,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function dispatchJson(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    targetDeviceId: row.target_device_id,
    targetUserId: row.target_user_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    senderDeviceId: row.sender_device_id,
    crossAccount: Boolean(row.cross_account),
    goal: row.goal,
    context: parseJson(row.context_json, []),
    options: parseJson(row.options_json, {}),
    parent: parseJson(row.parent_json, null),
    status: row.status,
    runId: row.run_id,
    summary: row.summary,
    result: row.result,
    sources: parseJson(row.sources_json, []),
    error: row.error,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function messageJson(row) {
  return {
    id: row.id,
    dispatchId: row.dispatch_id,
    fromUserId: row.from_user_id,
    fromDeviceId: row.from_device_id,
    kind: row.kind,
    text: row.text,
    replyTo: row.reply_to,
    createdAt: row.created_at,
  };
}

function vaultJson(row) {
  if (!row) return null;
  return {
    version: row.version,
    kdf: parseJson(row.kdf_json, {}),
    salt: row.salt,
    iv: row.iv,
    ciphertext: row.ciphertext,
    updatedAt: row.updated_at,
  };
}

function validEnum(value, allowed, label) {
  if (!allowed.has(value)) fail(400, 'invalid_input', `${label}不支援`);
  return value;
}

function safeArray(value, label, limit = 500) {
  if (!Array.isArray(value) || value.length > limit) fail(400, 'invalid_input', `${label}格式不正確`);
  return value;
}

function validTimestamp(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return requireFiniteNumber(value, '時間', { min: 0, max: 9_999_999_999_999 });
}

function parseWebsiteOrigins(value) {
  return new Set(String(value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
}

function isChromeExtensionOrigin(origin) {
  return /^chrome-extension:\/\/[a-p]{32}$/i.test(origin);
}

function rateLimiter({ now, limits }) {
  const buckets = new Map();
  return (scope, key) => {
    const config = limits[scope];
    if (!config) return;
    const bucketKey = `${scope}:${key}`;
    const start = now() - config.windowMs;
    const values = (buckets.get(bucketKey) ?? []).filter((time) => time > start);
    if (values.length >= config.max) fail(429, 'rate_limited', '操作太頻繁，請稍後再試');
    values.push(now());
    buckets.set(bucketKey, values);
  };
}

function parseBearer(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header ?? ''));
  return match?.[1] ?? null;
}

function databasePathFromOptions(options) {
  return options.databasePath || process.env.DATABASE_PATH || ':memory:';
}

export function createApp(options = {}) {
  const database = options.database ?? createDatabase(databasePathFromOptions(options));
  const now = options.now ?? (() => Date.now());
  const websiteOrigins = parseWebsiteOrigins(options.websiteOrigins ?? process.env.WEBSITE_ORIGINS);
  const limits = {
    auth: { max: options.rateLimits?.authMax ?? 10, windowMs: options.rateLimits?.windowMs ?? 60_000 },
    dispatch: { max: options.rateLimits?.dispatchMax ?? 30, windowMs: options.rateLimits?.windowMs ?? 60_000 },
  };
  const enforceRate = rateLimiter({ now, limits });
  const streams = new Map();
  const app = express();

  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY;
  if (trustProxy === 'true' || trustProxy === true) app.set('trust proxy', true);
  else if (typeof trustProxy === 'string' && /^\d+$/.test(trustProxy)) app.set('trust proxy', Number(trustProxy));

  function isOnline(deviceId) {
    return (streams.get(deviceId)?.size ?? 0) > 0;
  }

  function userDeviceIds(userIds) {
    if (!userIds.length) return [];
    const placeholders = userIds.map(() => '?').join(',');
    return database.prepare(`SELECT id FROM devices WHERE user_id IN (${placeholders})`).all(...userIds).map((row) => row.id);
  }

  function projectDeviceIds(projectId) {
    return database.prepare(`
      SELECT d.id FROM devices d
      JOIN project_members pm ON pm.user_id = d.user_id
      WHERE pm.project_id = ?
    `).all(projectId).map((row) => row.id);
  }

  function relatedDeviceIds(userId) {
    return database.prepare(`
      SELECT DISTINCT d.id FROM devices d
      WHERE d.user_id = ? OR EXISTS (
        SELECT 1 FROM project_members mine
        JOIN project_members peer ON peer.project_id = mine.project_id
        WHERE mine.user_id = ? AND peer.user_id = d.user_id
      )
    `).all(userId, userId).map((row) => row.id);
  }

  function canSeeDevice(userId, deviceId) {
    const device = database.prepare('SELECT user_id FROM devices WHERE id = ?').get(deviceId);
    if (!device) return false;
    if (device.user_id === userId) return true;
    return Boolean(database.prepare(`
      SELECT 1 FROM project_members mine
      JOIN project_members peer ON peer.project_id = mine.project_id
      WHERE mine.user_id = ? AND peer.user_id = ?
      LIMIT 1
    `).get(userId, device.user_id));
  }

  function writeSse(response, event) {
    response.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  function emit(type, payload, deviceIds, projectId = null) {
    const targets = [...new Set(deviceIds.filter(Boolean))];
    if (targets.length === 0) return null;
    const createdAt = now();
    const encoded = JSON.stringify(payload);
    const result = database.prepare('INSERT INTO sse_events (type, payload_json, project_id, created_at) VALUES (?, ?, ?, ?)')
      .run(type, encoded, projectId, createdAt);
    const seq = Number(result.lastInsertRowid);
    const insertDelivery = database.prepare('INSERT OR IGNORE INTO sse_deliveries (seq, device_id) VALUES (?, ?)');
    for (const deviceId of targets) insertDelivery.run(seq, deviceId);
    const event = { seq, type, payload, createdAt };
    for (const deviceId of targets) {
      for (const response of streams.get(deviceId) ?? []) {
        try { writeSse(response, event); } catch { /* 連線已由 close handler 清理 */ }
      }
    }
    return event;
  }

  function emitProject(projectId, type, payload) {
    return emit(type, payload, projectDeviceIds(projectId), projectId);
  }

  function activeDispatchParties(row) {
    return [...new Set([row.sender_user_id, row.target_user_id])].filter((userId) =>
      Boolean(database.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(row.project_id, userId)),
    );
  }

  function emitDispatchUpdate(row, type = 'dispatch_update') {
    const parties = activeDispatchParties(row);
    return emit(type, { dispatch: dispatchJson(row) }, userDeviceIds(parties), row.project_id);
  }

  function emitPresence(deviceId, online, lastSeenAt) {
    const device = database.prepare('SELECT user_id FROM devices WHERE id = ?').get(deviceId);
    if (!device) return;
    emit('device_presence', { deviceId, online, lastSeenAt }, relatedDeviceIds(device.user_id));
  }

  function getMemberProject(projectId, userId) {
    return database.prepare(`
      SELECT p.*, pm.role FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE p.id = ? AND pm.user_id = ?
    `).get(projectId, userId);
  }

  function requireProjectMember(projectId, userId) {
    const project = getMemberProject(projectId, userId);
    if (!project) notFound();
    return project;
  }

  function requireProjectOwner(projectId, userId) {
    const project = requireProjectMember(projectId, userId);
    if (project.owner_id !== userId) forbidden('只有專案擁有者可以執行這個操作');
    return project;
  }

  function requireOwnDevice(deviceId, userId) {
    const device = database.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(deviceId, userId);
    if (!device) notFound();
    return device;
  }

  function requireRun(id, userId) {
    const run = database.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (!run) notFound();
    requireProjectMember(run.project_id, userId);
    return run;
  }

  function requireRunOwner(id, userId) {
    const run = requireRun(id, userId);
    if (run.owner_user_id !== userId) forbidden('只有建立這個任務的使用者可以更新它');
    return run;
  }

  function expirePendingDispatches() {
    const expired = database.prepare("SELECT * FROM dispatches WHERE status = 'pending' AND expires_at <= ?").all(now());
    if (!expired.length) return [];
    const update = database.prepare("UPDATE dispatches SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'");
    for (const dispatch of expired) {
      const updatedAt = now();
      update.run(updatedAt, dispatch.id);
      emitDispatchUpdate({ ...dispatch, status: 'expired', updated_at: updatedAt });
    }
    return expired;
  }

  function cancelProjectDispatches(projectId, removedUserId = null, targetDeviceId = null, notify = true) {
    const clauses = ["project_id = ?", "status IN ('pending', 'accepted')"];
    const params = [projectId];
    if (removedUserId) {
      clauses.push('(sender_user_id = ? OR target_user_id = ?)');
      params.push(removedUserId, removedUserId);
    }
    if (targetDeviceId) {
      clauses.push('target_device_id = ?');
      params.push(targetDeviceId);
    }
    const rows = database.prepare(`SELECT * FROM dispatches WHERE ${clauses.join(' AND ')}`).all(...params);
    const update = database.prepare("UPDATE dispatches SET status = 'cancelled', updated_at = ? WHERE id = ?");
    for (const row of rows) {
      const updatedAt = now();
      update.run(updatedAt, row.id);
      row.status = 'cancelled';
      row.updated_at = updatedAt;
      if (notify) emitDispatchUpdate(row);
    }
    return rows;
  }

  function requireDispatchParty(id, userId) {
    expirePendingDispatches();
    const dispatch = database.prepare('SELECT * FROM dispatches WHERE id = ? AND (sender_user_id = ? OR target_user_id = ?)').get(id, userId, userId);
    if (!dispatch) notFound();
    requireProjectMember(dispatch.project_id, userId);
    return dispatch;
  }

  function replaceTasks(runId, tasks) {
    database.prepare('DELETE FROM tasks WHERE run_id = ?').run(runId);
    const insert = database.prepare(`
      INSERT INTO tasks (id, run_id, parent_task_id, title, agent, status, provider, model, result, sources_json, error, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const task of tasks) {
      const input = requireObject(task, 'Task');
      const id = requireId(input.id, 'Task ID');
      const title = requireString(input.title, 'Task 標題', { max: 500 });
      const agent = validEnum(requireString(input.agent, 'Task agent', { max: 40 }), TASK_AGENTS, 'Task agent');
      const status = validEnum(requireString(input.status, 'Task 狀態', { max: 40 }), TASK_STATUSES, 'Task 狀態');
      const sources = input.sources === undefined ? [] : safeArray(input.sources, 'Task sources', 100);
      insert.run(
        id, runId, optionalString(input.parentTaskId, 'parentTaskId', { max: 160 }), title, agent, status,
        optionalString(input.provider, 'provider', { max: 80 }), optionalString(input.model, 'model', { max: 160 }),
        optionalString(input.result, 'Task result', { max: 1_000_000, trim: false }), JSON.stringify(sources),
        optionalString(input.error, 'Task error', { max: 20_000, trim: false }),
        input.startedAt === undefined ? null : validTimestamp(input.startedAt, null),
        input.finishedAt === undefined ? null : validTimestamp(input.finishedAt, null),
      );
    }
  }

  function parseRunInput(body, pathId) {
    requireObject(body);
    assertNoSensitiveFields(body);
    if (Object.hasOwn(body, 'context')) fail(400, 'invalid_input', 'Run 不可上傳 context');
    if (body.id !== undefined && body.id !== pathId) fail(400, 'invalid_input', 'Run ID 與路徑不一致');
    const tasks = body.tasks === undefined ? [] : safeArray(body.tasks, 'tasks');
    return {
      projectId: requireId(body.projectId, 'projectId'),
      deviceId: body.deviceId === null || body.deviceId === undefined ? null : requireId(body.deviceId, 'deviceId'),
      goal: requireString(body.goal, 'goal', { max: 20_000, trim: false }),
      status: validEnum(requireString(body.status, 'Run 狀態', { max: 40 }), RUN_STATUSES, 'Run 狀態'),
      mode: validEnum(requireString(body.mode, 'Run 模式', { max: 40 }), RUN_MODES, 'Run 模式'),
      planSummary: requireString(body.planSummary ?? '', 'planSummary', { min: 0, max: 100_000, trim: false }),
      finalResult: body.finalResult === null || body.finalResult === undefined ? null : requireString(body.finalResult, 'finalResult', { min: 0, max: 2_000_000, trim: false }),
      error: body.error === null || body.error === undefined ? null : requireString(body.error, 'error', { min: 0, max: 50_000, trim: false }),
      costUsd: body.costUsd === undefined ? 0 : requireFiniteNumber(body.costUsd, 'costUsd', { min: 0, max: 1_000_000 }),
      inputTokens: body.inputTokens === undefined ? 0 : requireFiniteNumber(body.inputTokens, 'inputTokens', { min: 0, max: 1_000_000_000 }),
      outputTokens: body.outputTokens === undefined ? 0 : requireFiniteNumber(body.outputTokens, 'outputTokens', { min: 0, max: 1_000_000_000 }),
      createdAt: validTimestamp(body.createdAt, now()),
      finishedAt: body.finishedAt === null || body.finishedAt === undefined ? null : validTimestamp(body.finishedAt, null),
      tasks,
    };
  }

  function parseVault(body) {
    requireObject(body);
    const expectedVersion = requireFiniteNumber(body.expectedVersion, 'expectedVersion', { min: 0, max: 1_000_000_000 });
    const kdf = requireObject(body.kdf, 'kdf');
    if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || kdf.iterations !== 600000) {
      fail(400, 'invalid_input', 'kdf 必須使用指定的 PBKDF2 參數');
    }
    for (const [key, value] of Object.entries({ salt: body.salt, iv: body.iv, ciphertext: body.ciphertext })) {
      if (!isBase64(value)) fail(400, 'invalid_input', `${key} 必須是 base64`);
    }
    if (Buffer.from(body.ciphertext, 'base64').byteLength > MAX_VAULT_BYTES) fail(413, 'too_large', '保險箱密文超過 64 KB');
    return { expectedVersion, kdf, salt: body.salt, iv: body.iv, ciphertext: body.ciphertext };
  }

  function publicDispatchById(id) {
    const row = database.prepare('SELECT * FROM dispatches WHERE id = ?').get(id);
    return row ? dispatchJson(row) : null;
  }

  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const origin = request.get('origin');
    const allowed = origin && (isChromeExtensionOrigin(origin) || websiteOrigins.has(origin));
    if (allowed) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      if (origin && !allowed) return response.status(403).json({ error: { code: 'forbidden', message: '不允許的來源' } });
      return response.status(204).end();
    }
    return next();
  });
  app.use(express.json({ limit: '6mb', strict: true }));

  const authenticate = asyncRoute(async (request, _response, next) => {
    const token = parseBearer(request.get('authorization'));
    if (!token) unauthorized();
    const row = database.prepare(`
      SELECT u.* FROM auth_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?
    `).get(tokenHash(token));
    if (!row) unauthorized();
    request.user = userJson(row);
    request.tokenHash = tokenHash(token);
    next();
  });

  app.post('/api/auth/register', asyncRoute(async (request, response) => {
    enforceRate('auth', request.ip);
    const body = requireObject(request.body);
    const email = normalizedEmail(body.email);
    const password = requireString(body.password, '密碼', { min: 10, max: 1024, trim: false });
    const displayName = requireString(body.displayName, '顯示名稱', { max: 80 });
    const passwordHash = await hashPassword(password);
    const user = { id: newId(), email, displayName, createdAt: now() };
    const token = opaqueToken();
    try {
      transaction(database, () => {
        database.prepare('INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, user.email, passwordHash, user.displayName, user.createdAt);
        database.prepare('INSERT INTO auth_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)')
          .run(tokenHash(token), user.id, user.createdAt);
      });
    } catch (error) {
      if (/UNIQUE constraint failed: users\.email/i.test(error.message)) fail(409, 'conflict', '這個 Email 已註冊');
      throw error;
    }
    response.status(201).json({ token, user });
  }));

  app.post('/api/auth/login', asyncRoute(async (request, response) => {
    enforceRate('auth', request.ip);
    const body = requireObject(request.body);
    const email = normalizedEmail(body.email);
    const password = requireString(body.password, '密碼', { min: 1, max: 1024, trim: false });
    const row = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = row ? await verifyPassword(password, row.password_hash) : false;
    if (!valid) fail(401, 'invalid_credentials', 'Email 或密碼錯誤');
    const token = opaqueToken();
    database.prepare('INSERT INTO auth_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)')
      .run(tokenHash(token), row.id, now());
    response.json({ token, user: userJson(row) });
  }));

  app.post('/api/auth/logout', authenticate, asyncRoute(async (request, response) => {
    database.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(request.tokenHash);
    response.status(204).end();
  }));

  app.get('/api/me', authenticate, (request, response) => response.json({ user: request.user }));

  app.put('/api/devices/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '裝置 ID');
    const body = requireObject(request.body);
    const name = requireString(body.name, '裝置名稱', { max: 120 });
    const platform = requireString(body.platform, '平台', { max: 80 });
    const previous = database.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (previous && previous.user_id !== request.user.id) notFound();
    const time = now();
    if (previous) {
      database.prepare('UPDATE devices SET name = ?, platform = ?, updated_at = ?, last_seen_at = ? WHERE id = ?')
        .run(name, platform, time, time, id);
    } else {
      database.prepare('INSERT INTO devices (id, user_id, name, platform, accept_remote, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, request.user.id, name, platform, 'ask', time, time, time);
    }
    const device = database.prepare(`SELECT d.*, u.display_name AS owner_name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ?`).get(id);
    response.json({ device: deviceJson(device, isOnline(id), request.user.id) });
  }));

  app.get('/api/devices', authenticate, asyncRoute(async (request, response) => {
    const rows = database.prepare(`
      SELECT DISTINCT d.*, u.display_name AS owner_name FROM devices d
      JOIN users u ON u.id = d.user_id
      WHERE d.user_id = ? OR EXISTS (
        SELECT 1 FROM project_members mine
        JOIN project_members peer ON peer.project_id = mine.project_id
        WHERE mine.user_id = ? AND peer.user_id = d.user_id
      )
      ORDER BY d.updated_at DESC
    `).all(request.user.id, request.user.id);
    response.json({ devices: rows.map((row) => deviceJson(row, isOnline(row.id), request.user.id)) });
  }));

  app.patch('/api/devices/:id', authenticate, asyncRoute(async (request, response) => {
    const device = requireOwnDevice(requireId(request.params.id, '裝置 ID'), request.user.id);
    const body = requireObject(request.body);
    const name = body.name === undefined ? device.name : requireString(body.name, '裝置名稱', { max: 120 });
    let acceptRemote = device.accept_remote;
    if (body.acceptRemote !== undefined) acceptRemote = validEnum(requireString(body.acceptRemote, 'acceptRemote', { max: 20 }), new Set(['off', 'ask', 'auto']), 'acceptRemote');
    if (body.name === undefined && body.acceptRemote === undefined) fail(400, 'invalid_input', '至少要提供一個可更新欄位');
    const time = now();
    database.prepare('UPDATE devices SET name = ?, accept_remote = ?, updated_at = ?, last_seen_at = ? WHERE id = ?').run(name, acceptRemote, time, time, device.id);
    const row = database.prepare(`SELECT d.*, u.display_name AS owner_name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ?`).get(device.id);
    response.json({ device: deviceJson(row, isOnline(row.id), request.user.id) });
  }));

  app.delete('/api/devices/:id', authenticate, asyncRoute(async (request, response) => {
    const device = requireOwnDevice(requireId(request.params.id, '裝置 ID'), request.user.id);
    const affectedProjects = database.prepare('SELECT DISTINCT project_id FROM dispatches WHERE target_device_id = ?').all(device.id);
    for (const project of affectedProjects) cancelProjectDispatches(project.project_id, null, device.id);
    database.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
    streams.delete(device.id);
    response.status(204).end();
  }));

  app.get('/api/stream', authenticate, asyncRoute(async (request, response) => {
    const deviceId = requireId(request.query.deviceId, 'deviceId');
    const device = requireOwnDevice(deviceId, request.user.id);
    const since = request.query.since === undefined ? 0 : Number(request.query.since);
    if (!Number.isSafeInteger(since) || since < 0) fail(400, 'invalid_input', 'since 必須是非負整數');

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    const set = streams.get(deviceId) ?? new Set();
    const wasOnline = set.size > 0;
    set.add(response);
    streams.set(deviceId, set);
    const time = now();
    database.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(time, deviceId);
    if (!wasOnline) emitPresence(deviceId, true, time);

    const replay = database.prepare(`
      SELECT e.seq, e.type, e.payload_json, e.created_at FROM sse_events e
      JOIN sse_deliveries d ON d.seq = e.seq
      WHERE d.device_id = ? AND e.seq > ?
        AND (e.project_id IS NULL OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.project_id = e.project_id AND pm.user_id = ?
        ))
      ORDER BY e.seq ASC
    `).all(deviceId, since, request.user.id);
    for (const event of replay) {
      const payload = parseJson(event.payload_json, {});
      if (event.type === 'device_presence' && !canSeeDevice(request.user.id, payload.deviceId)) continue;
      writeSse(response, { seq: event.seq, type: event.type, payload, createdAt: event.created_at });
    }
    response.write(': connected\n\n');
    const heartbeat = setInterval(() => {
      try { response.write(': keepalive\n\n'); } catch { /* close handler will clean up */ }
    }, 25_000);
    heartbeat.unref?.();
    const close = () => {
      clearInterval(heartbeat);
      const current = streams.get(deviceId);
      if (!current) return;
      current.delete(response);
      if (current.size === 0) {
        streams.delete(deviceId);
        const lastSeenAt = now();
        database.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, deviceId);
        emitPresence(deviceId, false, lastSeenAt);
      }
    };
    request.on('close', close);
  }));

  app.get('/api/vault', authenticate, asyncRoute(async (request, response) => {
    const vault = database.prepare('SELECT * FROM vaults WHERE user_id = ?').get(request.user.id);
    response.json({ vault: vaultJson(vault) });
  }));

  app.put('/api/vault', authenticate, asyncRoute(async (request, response) => {
    const input = parseVault(request.body);
    const time = now();
    let row;
    transaction(database, () => {
      const existing = database.prepare('SELECT * FROM vaults WHERE user_id = ?').get(request.user.id);
      const version = (existing?.version ?? 0) + 1;
      if ((existing?.version ?? 0) !== input.expectedVersion) fail(409, 'conflict', '保險箱版本已變更，請重新取得後再試');
      if (existing) {
        database.prepare('UPDATE vaults SET version = ?, kdf_json = ?, salt = ?, iv = ?, ciphertext = ?, updated_at = ? WHERE user_id = ?')
          .run(version, JSON.stringify(input.kdf), input.salt, input.iv, input.ciphertext, time, request.user.id);
      } else {
        database.prepare('INSERT INTO vaults (user_id, version, kdf_json, salt, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(request.user.id, version, JSON.stringify(input.kdf), input.salt, input.iv, input.ciphertext, time);
      }
      row = database.prepare('SELECT * FROM vaults WHERE user_id = ?').get(request.user.id);
    });
    emit('vault_update', { version: row.version, updatedAt: row.updated_at }, userDeviceIds([request.user.id]));
    response.json({ vault: vaultJson(row) });
  }));

  app.delete('/api/vault', authenticate, asyncRoute(async (request, response) => {
    database.prepare('DELETE FROM vaults WHERE user_id = ?').run(request.user.id);
    emit('vault_update', { version: null, updatedAt: now() }, userDeviceIds([request.user.id]));
    response.status(204).end();
  }));

  app.put('/api/projects/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '專案 ID');
    const body = requireObject(request.body);
    const name = requireString(body.name, '專案名稱', { max: 200 });
    const description = requireString(body.description ?? '', '專案說明', { min: 0, max: 20_000, trim: false });
    const existing = database.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    const time = now();
    if (existing) {
      requireProjectOwner(id, request.user.id);
      database.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, time, id);
    } else {
      transaction(database, () => {
        database.prepare('INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, request.user.id, name, description, time, time);
        database.prepare('INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
          .run(id, request.user.id, 'owner', time);
      });
    }
    const project = getMemberProject(id, request.user.id);
    emitProject(id, 'run_update', { projectId: id, action: 'project_updated' });
    response.json({ project: projectJson(project) });
  }));

  app.get('/api/projects', authenticate, asyncRoute(async (request, response) => {
    const rows = database.prepare(`
      SELECT p.*, pm.role FROM projects p JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ? ORDER BY p.updated_at DESC
    `).all(request.user.id);
    response.json({ projects: rows.map(projectJson) });
  }));

  app.delete('/api/projects/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '專案 ID');
    requireProjectOwner(id, request.user.id);
    database.prepare('DELETE FROM projects WHERE id = ?').run(id);
    response.status(204).end();
  }));

  app.post('/api/projects/:id/invites', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    requireProjectOwner(projectId, request.user.id);
    const code = opaqueToken();
    const expiresAt = now() + INVITE_EXPIRY_MS;
    database.prepare('INSERT INTO invites (code_hash, project_id, expires_at, used_at) VALUES (?, ?, ?, NULL)')
      .run(tokenHash(code), projectId, expiresAt);
    response.status(201).json({ code, expiresAt });
  }));

  app.post('/api/invites/accept', authenticate, asyncRoute(async (request, response) => {
    const code = requireString(requireObject(request.body).code, '邀請碼', { max: 300, trim: false });
    let project;
    transaction(database, () => {
      const invite = database.prepare('SELECT * FROM invites WHERE code_hash = ?').get(tokenHash(code));
      if (!invite || invite.used_at || invite.expires_at <= now()) notFound();
      const source = database.prepare('SELECT * FROM projects WHERE id = ?').get(invite.project_id);
      if (!source) notFound();
      database.prepare('UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').run(now(), invite.code_hash);
      database.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
        .run(source.id, request.user.id, 'member', now());
      project = getMemberProject(source.id, request.user.id);
    });
    emitProject(project.id, 'member_update', { projectId: project.id, userId: request.user.id, action: 'joined' });
    response.json({ project: projectJson(project) });
  }));

  app.get('/api/projects/:id/members', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    requireProjectMember(projectId, request.user.id);
    const members = database.prepare(`
      SELECT pm.user_id, pm.role, u.display_name, u.email FROM project_members pm
      JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.created_at ASC
    `).all(projectId).map((row) => ({ userId: row.user_id, displayName: row.display_name, email: row.email, role: row.role }));
    response.json({ members });
  }));

  app.delete('/api/projects/:id/members/:userId', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    const userId = requireId(request.params.userId, '使用者 ID');
    const project = requireProjectMember(projectId, request.user.id);
    const target = database.prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
    if (!target) notFound();
    if (userId !== request.user.id && project.owner_id !== request.user.id) forbidden('只有擁有者可以移除其他成員');
    if (target.role === 'owner') fail(400, 'invalid_input', '專案擁有者不能離開專案，請改為刪除專案');
    let cancelled = [];
    transaction(database, () => {
      database.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
      cancelled = cancelProjectDispatches(projectId, userId, null, false);
    });
    for (const dispatch of cancelled) emitDispatchUpdate(dispatch);
    emitProject(projectId, 'member_update', { projectId, userId, action: 'removed' });
    response.status(204).end();
  }));

  app.put('/api/runs/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, 'Run ID');
    const input = parseRunInput(request.body, id);
    const existing = database.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (existing) {
      requireRunOwner(id, request.user.id);
      if (existing.project_id !== input.projectId) fail(409, 'conflict', 'Run 不可移到其他專案');
    } else {
      requireProjectMember(input.projectId, request.user.id);
    }
    if (input.deviceId) requireOwnDevice(input.deviceId, request.user.id);
    const time = now();
    transaction(database, () => {
      if (existing) {
        database.prepare(`
          UPDATE runs SET device_id = ?, goal = ?, status = ?, mode = ?, plan_summary = ?, final_result = ?, error = ?,
            cost_usd = ?, input_tokens = ?, output_tokens = ?, finished_at = ?, updated_at = ? WHERE id = ?
        `).run(input.deviceId, input.goal, input.status, input.mode, input.planSummary, input.finalResult, input.error,
          input.costUsd, input.inputTokens, input.outputTokens, input.finishedAt, time, id);
      } else {
        database.prepare(`
          INSERT INTO runs (id, project_id, owner_user_id, device_id, goal, status, mode, plan_summary, final_result, error, cost_usd, input_tokens, output_tokens, created_at, finished_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.projectId, request.user.id, input.deviceId, input.goal, input.status, input.mode, input.planSummary,
          input.finalResult, input.error, input.costUsd, input.inputTokens, input.outputTokens, input.createdAt, input.finishedAt, time);
      }
      replaceTasks(id, input.tasks);
    });
    const run = database.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    emitProject(run.project_id, 'run_update', { runId: id, status: run.status });
    response.json({ run: { ...runJson(run, { full: true }), tasks: database.prepare('SELECT * FROM tasks WHERE run_id = ?').all(id).map(taskJson) } });
  }));

  app.post('/api/runs/:id/events', authenticate, asyncRoute(async (request, response) => {
    const run = requireRunOwner(requireId(request.params.id, 'Run ID'), request.user.id);
    const events = safeArray(requireObject(request.body).events, 'events', 200);
    const insert = database.prepare('INSERT OR IGNORE INTO run_events (run_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)');
    let accepted = 0;
    transaction(database, () => {
      for (const item of events) {
        const event = requireObject(item, 'Event');
        if (event.runId !== undefined && event.runId !== run.id) fail(400, 'invalid_input', 'Event runId 與路徑不一致');
        const seq = requireFiniteNumber(event.seq, 'Event seq', { min: 0, max: 2_147_483_647 });
        if (!Number.isInteger(seq)) fail(400, 'invalid_input', 'Event seq 必須是整數');
        const type = requireString(event.type, 'Event type', { max: 100 });
        const payload = requireObject(event.payload ?? {}, 'Event payload');
        assertNoSensitiveFields(payload);
        const createdAt = validTimestamp(event.createdAt, now());
        accepted += insert.run(run.id, seq, type, JSON.stringify(payload), createdAt).changes;
      }
    });
    if (accepted) emitProject(run.project_id, 'run_update', { runId: run.id, eventCount: accepted });
    response.json({ accepted });
  }));

  app.put('/api/runs/:id/artifacts/:artifactId', authenticate, asyncRoute(async (request, response) => {
    const run = requireRunOwner(requireId(request.params.id, 'Run ID'), request.user.id);
    const artifactId = requireId(request.params.artifactId, 'Artifact ID');
    const body = requireObject(request.body);
    assertNoSensitiveFields(body);
    if (body.id !== undefined && body.id !== artifactId) fail(400, 'invalid_input', 'Artifact ID 與路徑不一致');
    if (body.runId !== undefined && body.runId !== run.id) fail(400, 'invalid_input', 'Artifact runId 與路徑不一致');
    const name = requireString(body.name, 'Artifact 名稱', { max: 300 });
    const kind = validEnum(requireString(body.kind, 'Artifact kind', { max: 30 }), ARTIFACT_KINDS, 'Artifact kind');
    const content = requireString(body.content, 'Artifact content', { min: 0, max: MAX_ARTIFACT_BYTES, trim: false });
    if (Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES) fail(413, 'too_large', 'Artifact 超過 5 MB');
    const createdBy = optionalString(body.createdBy, 'createdBy', { max: 80 });
    const time = now();
    database.prepare(`
      INSERT INTO artifacts (id, run_id, name, kind, content, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, content = excluded.content, created_by = excluded.created_by, updated_at = excluded.updated_at
    `).run(artifactId, run.id, name, kind, content, createdBy, time, time);
    const artifact = database.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId);
    emitProject(run.project_id, 'run_update', { runId: run.id, artifactId });
    response.json({ artifact: artifactJson(artifact) });
  }));

  app.get('/api/projects/:id/runs', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    requireProjectMember(projectId, request.user.id);
    const runs = database.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map((row) => runJson(row));
    response.json({ runs });
  }));

  app.get('/api/runs/:id', authenticate, asyncRoute(async (request, response) => {
    const run = requireRun(requireId(request.params.id, 'Run ID'), request.user.id);
    const tasks = database.prepare('SELECT * FROM tasks WHERE run_id = ?').all(run.id).map(taskJson);
    const events = database.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY seq ASC').all(run.id)
      .map((row) => {
        const payload = parseJson(row.payload_json, {});
        // tool_call.args 可能含使用者輸入，只能給原帳號的 Run 上傳者查看。
        if (run.owner_user_id !== request.user.id && row.type === 'tool_call' && payload && typeof payload === 'object') {
          const { args: _args, ...redacted } = payload;
          return { seq: row.seq, runId: row.run_id, type: row.type, payload: { ...redacted, argsRedacted: true }, createdAt: row.created_at };
        }
        return { seq: row.seq, runId: row.run_id, type: row.type, payload, createdAt: row.created_at };
      });
    const artifacts = database.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC').all(run.id).map(artifactJson);
    response.json({ run: { ...runJson(run, { full: true }), tasks, events, artifacts } });
  }));

  app.post('/api/dispatches', authenticate, asyncRoute(async (request, response) => {
    expirePendingDispatches();
    enforceRate('dispatch', request.user.id);
    const body = requireObject(request.body);
    assertNoSensitiveFields(body);
    const id = requireId(body.id, '派工 ID');
    const projectId = requireId(body.projectId, 'projectId');
    requireProjectMember(projectId, request.user.id);
    const targetDeviceId = requireId(body.targetDeviceId, 'targetDeviceId');
    const targetDevice = database.prepare('SELECT * FROM devices WHERE id = ?').get(targetDeviceId);
    if (!targetDevice) notFound();
    const targetMembership = database.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, targetDevice.user_id);
    if (targetDevice.user_id !== request.user.id && !targetMembership) notFound();
    if (targetDevice.accept_remote === 'off') forbidden('目標裝置目前不接受遠端派工');
    const senderDeviceId = body.senderDeviceId === undefined || body.senderDeviceId === null ? null : requireId(body.senderDeviceId, 'senderDeviceId');
    if (senderDeviceId) requireOwnDevice(senderDeviceId, request.user.id);
    const goal = requireString(body.goal, 'goal', { max: 20 * 1024, trim: false });
    if (Buffer.byteLength(goal, 'utf8') > 20 * 1024) fail(413, 'too_large', 'goal 超過 20 KB');
    const context = safeArray(body.context ?? [], 'context', 500);
    if (jsonByteLength(context) > 200 * 1024) fail(413, 'too_large', 'context 超過 200 KB');
    const optionsValue = body.options === undefined ? {} : requireObject(body.options, 'options');
    const parent = body.parent === undefined || body.parent === null ? null : requireObject(body.parent, 'parent');
    const sender = database.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);
    const time = now();
    try {
      database.prepare(`
        INSERT INTO dispatches (id, project_id, target_device_id, target_user_id, sender_user_id, sender_name, sender_device_id, cross_account, goal, context_json, options_json, parent_json, status, run_id, summary, result, sources_json, error, cost_usd, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, '[]', NULL, 0, ?, ?, ?)
      `).run(id, projectId, targetDevice.id, targetDevice.user_id, request.user.id, sender.display_name, senderDeviceId,
        targetDevice.user_id === request.user.id ? 0 : 1, goal, JSON.stringify(context), JSON.stringify(optionsValue), parent ? JSON.stringify(parent) : null,
        time, time, time + DISPATCH_EXPIRY_MS);
    } catch (error) {
      if (/UNIQUE constraint failed: dispatches\.id/i.test(error.message)) fail(409, 'conflict', '派工 ID 已存在');
      throw error;
    }
    const dispatch = database.prepare('SELECT * FROM dispatches WHERE id = ?').get(id);
    emit('dispatch_created', { dispatch: dispatchJson(dispatch) }, [targetDevice.id], projectId);
    response.status(201).json({ dispatch: dispatchJson(dispatch) });
  }));

  app.get('/api/dispatches', authenticate, asyncRoute(async (request, response) => {
    expirePendingDispatches();
    const role = requireString(request.query.role, 'role', { max: 20 });
    if (!['incoming', 'outgoing'].includes(role)) fail(400, 'invalid_input', 'role 必須是 incoming 或 outgoing');
    const status = request.query.status === undefined ? null : requireString(request.query.status, 'status', { max: 20 });
    const column = role === 'incoming' ? 'target_user_id' : 'sender_user_id';
    const rows = status
      ? database.prepare(`
          SELECT d.* FROM dispatches d JOIN project_members pm ON pm.project_id = d.project_id
          WHERE d.${column} = ? AND pm.user_id = ? AND d.status = ? ORDER BY d.created_at DESC
        `).all(request.user.id, request.user.id, status)
      : database.prepare(`
          SELECT d.* FROM dispatches d JOIN project_members pm ON pm.project_id = d.project_id
          WHERE d.${column} = ? AND pm.user_id = ? ORDER BY d.created_at DESC
        `).all(request.user.id, request.user.id);
    response.json({ dispatches: rows.map(dispatchJson) });
  }));

  app.get('/api/dispatches/:id', authenticate, asyncRoute(async (request, response) => {
    const dispatch = requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    const messages = database.prepare('SELECT * FROM dispatch_messages WHERE dispatch_id = ? ORDER BY created_at ASC').all(dispatch.id).map(messageJson);
    response.json({ dispatch: dispatchJson(dispatch), messages });
  }));

  app.post('/api/dispatches/:id/accept', authenticate, asyncRoute(async (request, response) => {
    const dispatch = requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    if (dispatch.target_user_id !== request.user.id) notFound();
    if (!canTransitionDispatch(dispatch.status, 'accepted')) stateError();
    const target = dispatch.target_device_id ? requireOwnDevice(dispatch.target_device_id, request.user.id) : null;
    if (!target || target.accept_remote === 'off') forbidden('目標裝置目前不接受遠端派工');
    const runId = requireId(requireObject(request.body).runId, 'runId');
    const time = now();
    database.prepare("UPDATE dispatches SET status = 'accepted', run_id = ?, updated_at = ? WHERE id = ?").run(runId, time, dispatch.id);
    const updated = database.prepare('SELECT * FROM dispatches WHERE id = ?').get(dispatch.id);
    emitDispatchUpdate(updated);
    response.json({ dispatch: dispatchJson(updated) });
  }));

  app.post('/api/dispatches/:id/reject', authenticate, asyncRoute(async (request, response) => {
    const dispatch = requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    if (dispatch.target_user_id !== request.user.id) notFound();
    if (!canTransitionDispatch(dispatch.status, 'rejected')) stateError();
    const reason = optionalString(requireObject(request.body).reason, 'reason', { max: 20_000, trim: false });
    const time = now();
    database.prepare("UPDATE dispatches SET status = 'rejected', error = ?, updated_at = ? WHERE id = ?").run(reason, time, dispatch.id);
    const updated = database.prepare('SELECT * FROM dispatches WHERE id = ?').get(dispatch.id);
    emitDispatchUpdate(updated);
    response.json({ dispatch: dispatchJson(updated) });
  }));

  app.post('/api/dispatches/:id/report', authenticate, asyncRoute(async (request, response) => {
    const dispatch = requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    if (dispatch.target_user_id !== request.user.id) notFound();
    const body = requireObject(request.body);
    const status = validEnum(requireString(body.status, 'status', { max: 20 }), new Set(['done', 'partial', 'failed']), 'status');
    if (!canTransitionDispatch(dispatch.status, status)) stateError();
    const runId = requireId(body.runId, 'runId');
    const run = database.prepare('SELECT * FROM runs WHERE id = ? AND project_id = ? AND owner_user_id = ?').get(runId, dispatch.project_id, request.user.id);
    if (!run) fail(400, 'invalid_input', 'runId 必須是目標使用者在同一專案的任務');
    const summary = optionalString(body.summary, 'summary', { max: 100_000, trim: false });
    const result = optionalString(body.result, 'result', { max: 2_000_000, trim: false });
    const sources = body.sources === undefined ? [] : safeArray(body.sources, 'sources', 200);
    const error = optionalString(body.error, 'error', { max: 50_000, trim: false });
    const costUsd = body.costUsd === undefined ? 0 : requireFiniteNumber(body.costUsd, 'costUsd', { min: 0, max: 1_000_000 });
    const time = now();
    database.prepare(`
      UPDATE dispatches SET status = ?, run_id = ?, summary = ?, result = ?, sources_json = ?, error = ?, cost_usd = ?, updated_at = ? WHERE id = ?
    `).run(status, runId, summary, result, JSON.stringify(sources), error, costUsd, time, dispatch.id);
    const updated = database.prepare('SELECT * FROM dispatches WHERE id = ?').get(dispatch.id);
    emitDispatchUpdate(updated);
    response.json({ dispatch: dispatchJson(updated) });
  }));

  app.post('/api/dispatches/:id/cancel', authenticate, asyncRoute(async (request, response) => {
    const dispatch = requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    if (!canTransitionDispatch(dispatch.status, 'cancelled')) stateError();
    const time = now();
    database.prepare("UPDATE dispatches SET status = 'cancelled', updated_at = ? WHERE id = ?").run(time, dispatch.id);
    const updated = database.prepare('SELECT * FROM dispatches WHERE id = ?').get(dispatch.id);
    emitDispatchUpdate(updated);
    response.json({ dispatch: dispatchJson(updated) });
  }));

  app.post('/api/dispatches/:id/messages', authenticate, asyncRoute(async (request, response) => {
    const dispatch = requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    if (TERMINAL_DISPATCH_STATES.has(dispatch.status)) stateError('派工已結束，不能再傳送訊息');
    const body = requireObject(request.body);
    const id = requireId(body.id, '訊息 ID');
    const kind = validEnum(requireString(body.kind, '訊息類型', { max: 20 }), MESSAGE_KINDS, '訊息類型');
    const text = requireString(body.text, '訊息內容', { max: 20 * 1024, trim: false });
    if (Buffer.byteLength(text, 'utf8') > 20 * 1024) fail(413, 'too_large', '訊息內容超過 20 KB');
    const replyTo = optionalString(body.replyTo, 'replyTo', { max: 160 });
    const fromDeviceId = request.user.id === dispatch.target_user_id ? dispatch.target_device_id : dispatch.sender_device_id;
    const time = now();
    database.prepare(`
      INSERT OR IGNORE INTO dispatch_messages (id, dispatch_id, from_user_id, from_device_id, kind, text, reply_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, dispatch.id, request.user.id, fromDeviceId, kind, text, replyTo, time);
    const message = database.prepare('SELECT * FROM dispatch_messages WHERE id = ? AND dispatch_id = ?').get(id, dispatch.id);
    if (!message) fail(409, 'conflict', '訊息 ID 已用於其他派工');
    emit('dispatch_message', { dispatchId: dispatch.id, message: messageJson(message) }, userDeviceIds(activeDispatchParties(dispatch)), dispatch.project_id);
    response.status(201).json({ message: messageJson(message) });
  }));

  app.use((request, _response, next) => next(new ApiError(404, 'not_found', '找不到資源')));
  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) return response.status(413).json({ error: { code: 'too_large', message: '請求內容太大' } });
    if (error?.type === 'entity.parse.failed') return response.status(400).json({ error: { code: 'invalid_input', message: 'JSON 格式不正確' } });
    return jsonError(response, error);
  });

  const expiryTimer = setInterval(() => expirePendingDispatches(), 30_000);
  expiryTimer.unref?.();
  app.locals.database = database;
  app.locals.close = () => {
    clearInterval(expiryTimer);
    for (const responses of streams.values()) for (const response of responses) response.end();
    streams.clear();
    if (!options.database) database.close();
  };
  app.locals.expirePendingDispatches = expirePendingDispatches;
  app.locals.publicDispatchById = publicDispatchById;
  return app;
}
