import express from 'express';
import {
  ApiError, assertNoSensitiveFields, asyncRoute, fail, forbidden, hashPassword, isBase64,
  jsonByteLength, jsonError, newId, normalizedEmail, notFound, opaqueToken, optionalString,
  parseJson, requireFiniteNumber, requireId, requireObject, requireString, stateError,
  tokenHash, unauthorized, verifyPassword,
} from './util.js';
import { createDatabase } from './database.js';

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_VAULT_BYTES = 64 * 1024;
const DISPATCH_EXPIRY_MS = 10 * 60 * 1000;
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL = new Set(['rejected', 'done', 'partial', 'failed', 'cancelled', 'expired']);
const RUN_STATUSES = new Set(['planning', 'running', 'done', 'partial', 'failed', 'cancelled']);
const RUN_MODES = new Set(['auto', 'council', 'workflow']);
const TASK_STATUSES = new Set(['pending', 'running', 'done', 'failed']);
const TASK_AGENTS = new Set(['research', 'coding', '3d', 'vision', 'planning', 'review', 'browser']);
const ARTIFACT_KINDS = new Set(['html', 'code', 'markdown', 'data']);
const MESSAGE_KINDS = new Set(['question', 'answer', 'progress']);
const sql = (...parts) => parts.join('\n');

export function canTransitionDispatch(from, to) {
  return (from === 'pending' && ['accepted', 'rejected', 'cancelled', 'expired'].includes(to))
    || (from === 'accepted' && ['done', 'partial', 'failed', 'cancelled'].includes(to));
}

function userJson(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

function projectJson(row) {
  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, ...(row.role ? { role: row.role } : {}) };
}

function deviceJson(row, online, currentUserId) {
  return {
    id: row.id, userId: row.user_id, ownerName: row.owner_name, name: row.name, platform: row.platform,
    acceptRemote: row.accept_remote, online, lastSeenAt: row.last_seen_at, mine: row.user_id === currentUserId,
  };
}

function runJson(row, { full = false } = {}) {
  const output = {
    id: row.id, projectId: row.project_id, goal: row.goal, status: row.status, mode: row.mode,
    planSummary: row.plan_summary, costUsd: row.cost_usd, inputTokens: row.input_tokens,
    outputTokens: row.output_tokens, createdAt: row.created_at, finishedAt: row.finished_at, deviceId: row.device_id,
  };
  if (full) Object.assign(output, { finalResult: row.final_result, error: row.error });
  return output;
}

function taskJson(row) {
  return {
    id: row.id, runId: row.run_id, parentTaskId: row.parent_task_id, title: row.title, agent: row.agent,
    status: row.status, provider: row.provider, model: row.model, result: row.result,
    sources: parseJson(row.sources_json, []), error: row.error, startedAt: row.started_at, finishedAt: row.finished_at,
  };
}

function artifactJson(row) {
  return {
    id: row.id, runId: row.run_id, name: row.name, kind: row.kind, content: row.content,
    createdBy: row.created_by, createdAt: row.created_at,
  };
}

function dispatchJson(row) {
  return {
    id: row.id, projectId: row.project_id, targetDeviceId: row.target_device_id, targetUserId: row.target_user_id,
    senderUserId: row.sender_user_id, senderName: row.sender_name, senderDeviceId: row.sender_device_id,
    crossAccount: Boolean(row.cross_account), goal: row.goal, context: parseJson(row.context_json, []),
    options: parseJson(row.options_json, {}), parent: parseJson(row.parent_json, null), status: row.status,
    runId: row.run_id, summary: row.summary, result: row.result, sources: parseJson(row.sources_json, []),
    error: row.error, costUsd: row.cost_usd, createdAt: row.created_at, updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function messageJson(row) {
  return {
    id: row.id, dispatchId: row.dispatch_id, fromUserId: row.from_user_id, fromDeviceId: row.from_device_id,
    kind: row.kind, text: row.text, replyTo: row.reply_to, createdAt: row.created_at,
  };
}

function vaultJson(row) {
  return row ? {
    version: row.version, kdf: parseJson(row.kdf_json, {}), salt: row.salt, iv: row.iv,
    ciphertext: row.ciphertext, updatedAt: row.updated_at,
  } : null;
}

function validEnum(value, allowed, label) {
  if (!allowed.has(value)) fail(400, 'invalid_input', label + '不支援');
  return value;
}

function safeArray(value, label, limit = 500) {
  if (!Array.isArray(value) || value.length > limit) fail(400, 'invalid_input', label + '格式不正確');
  return value;
}

function validTimestamp(value, fallback) {
  return value === undefined || value === null
    ? fallback
    : requireFiniteNumber(value, '時間', { min: 0, max: 9_999_999_999_999 });
}

function parseRunInput(body, pathId, now) {
  requireObject(body);
  assertNoSensitiveFields(body);
  if (Object.hasOwn(body, 'context')) fail(400, 'invalid_input', 'Run 不可上傳 context');
  if (body.id !== undefined && body.id !== pathId) fail(400, 'invalid_input', 'Run ID 與路徑不一致');
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
    tasks: body.tasks === undefined ? [] : safeArray(body.tasks, 'tasks'),
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
    if (!isBase64(value)) fail(400, 'invalid_input', key + ' 必須是 base64');
  }
  if (Buffer.from(body.ciphertext, 'base64').byteLength > MAX_VAULT_BYTES) fail(413, 'too_large', '保險箱密文超過 64 KB');
  return { expectedVersion, kdf, salt: body.salt, iv: body.iv, ciphertext: body.ciphertext };
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
    const bucketKey = scope + ':' + key;
    const values = (buckets.get(bucketKey) ?? []).filter((time) => time > now() - config.windowMs);
    if (values.length >= config.max) fail(429, 'rate_limited', '操作太頻繁，請稍後再試');
    values.push(now());
    buckets.set(bucketKey, values);
  };
}

function parseBearer(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header ?? ''));
  return match?.[1] ?? null;
}

export async function createApp(options = {}) {
  const ownsDatabase = !options.database;
  const database = options.database ?? createDatabase({ connectionString: options.databaseUrl ?? process.env.DATABASE_URL });
  await database.initialize();
  const now = options.now ?? (() => Date.now());
  const enforceRate = rateLimiter({
    now,
    limits: {
      auth: { max: options.rateLimits?.authMax ?? 10, windowMs: options.rateLimits?.windowMs ?? 60_000 },
      dispatch: { max: options.rateLimits?.dispatchMax ?? 30, windowMs: options.rateLimits?.windowMs ?? 60_000 },
    },
  });
  const websiteOrigins = parseWebsiteOrigins(options.websiteOrigins ?? process.env.WEBSITE_ORIGINS);
  const streams = new Map();
  const app = express();
  let closing = false;
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY;
  if ((typeof trustProxy === 'number' && Number.isInteger(trustProxy) && trustProxy >= 0)
    || (typeof trustProxy === 'string' && /^\d+$/.test(trustProxy))) app.set('trust proxy', Number(trustProxy));

  const isOnline = (deviceId) => (streams.get(deviceId)?.size ?? 0) > 0;

  async function userDeviceIds(userIds) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return [];
    return (await database.many('SELECT id FROM devices WHERE user_id = ANY($1::text[])', [ids])).map((row) => row.id);
  }

  async function projectDeviceIds(projectId) {
    return (await database.many(sql(
      'SELECT d.id FROM devices d',
      'JOIN project_members pm ON pm.user_id = d.user_id',
      'WHERE pm.project_id = $1',
    ), [projectId])).map((row) => row.id);
  }

  async function relatedDeviceIds(userId) {
    return (await database.many(sql(
      'SELECT DISTINCT d.id FROM devices d',
      'WHERE d.user_id = $1 OR EXISTS (',
      'SELECT 1 FROM project_members mine JOIN project_members peer ON peer.project_id = mine.project_id',
      'WHERE mine.user_id = $1 AND peer.user_id = d.user_id',
      ')',
    ), [userId])).map((row) => row.id);
  }

  async function canSeeDevice(userId, deviceId) {
    const device = await database.one('SELECT user_id FROM devices WHERE id = $1', [deviceId]);
    if (!device) return false;
    if (device.user_id === userId) return true;
    return Boolean(await database.one(sql(
      'SELECT 1 FROM project_members mine JOIN project_members peer ON peer.project_id = mine.project_id',
      'WHERE mine.user_id = $1 AND peer.user_id = $2 LIMIT 1',
    ), [userId, device.user_id]));
  }

  function writeSse(response, event) {
    // deviceIds 是內部投遞用，送出去會洩漏其他使用者的裝置 ID
    const { deviceIds: _deviceIds, ...publicEvent } = event;
    response.write('id: ' + publicEvent.seq + '\ndata: ' + JSON.stringify(publicEvent) + '\n\n');
  }

  function publish(event) {
    for (const deviceId of event.deviceIds) {
      for (const response of streams.get(deviceId) ?? []) {
        try { writeSse(response, event); } catch { /* request close removes it */ }
      }
    }
  }

  async function recordEvent(type, payload, deviceIds, projectId = null) {
    const targets = [...new Set(deviceIds.filter(Boolean))];
    if (!targets.length) return null;
    // Held until COMMIT, so committed seq order cannot be inverted by concurrent transactions.
    await database.lockEventOrder();
    const createdAt = now();
    const inserted = await database.one(sql(
      'INSERT INTO sse_events (type, payload_json, project_id, created_at)',
      'VALUES ($1, $2, $3, $4) RETURNING seq',
    ), [type, JSON.stringify(payload), projectId, createdAt]);
    for (const deviceId of targets) {
      await database.query(sql(
        'INSERT INTO sse_deliveries (seq, device_id) VALUES ($1, $2)',
        'ON CONFLICT (seq, device_id) DO NOTHING',
      ), [inserted.seq, deviceId]);
    }
    return { seq: inserted.seq, type, payload, createdAt, deviceIds: targets };
  }

  async function mutate(work) {
    const events = [];
    const value = await database.transaction(async () => {
      // 寫入交易一開始就取得全域鎖：事件序號要照提交順序，而且列鎖與外鍵鎖的取得順序各路徑不同，
      // 等到寫事件才取鎖會互相等待而死鎖。伺服器是單機部署，序列化寫入的成本可接受。
      await database.lockEventOrder();
      const queue = async (type, payload, deviceIds, projectId = null) => {
        const event = await recordEvent(type, payload, deviceIds, projectId);
        if (event) events.push(event);
        return event;
      };
      return work(queue);
    });
    for (const event of events) publish(event);
    return value;
  }

  async function emitProject(queue, projectId, type, payload) {
    await queue(type, payload, await projectDeviceIds(projectId), projectId);
  }

  async function activeDispatchParties(row) {
    const ids = [...new Set([row.sender_user_id, row.target_user_id].filter(Boolean))];
    if (!ids.length) return [];
    return (await database.many(
      'SELECT user_id FROM project_members WHERE project_id = $1 AND user_id = ANY($2::text[])',
      [row.project_id, ids],
    )).map((member) => member.user_id);
  }

  async function emitDispatchUpdate(queue, row, type = 'dispatch_update') {
    await queue(type, { dispatch: dispatchJson(row) }, await userDeviceIds(await activeDispatchParties(row)), row.project_id);
  }

  async function emitPresence(queue, deviceId, online, lastSeenAt) {
    const device = await database.one('SELECT user_id FROM devices WHERE id = $1', [deviceId]);
    if (device) await queue('device_presence', { deviceId, online, lastSeenAt }, await relatedDeviceIds(device.user_id));
  }

  async function getMemberProject(projectId, userId, forUpdate = false) {
    return database.one(sql(
      'SELECT p.*, pm.role FROM projects p JOIN project_members pm ON pm.project_id = p.id',
      'WHERE p.id = $1 AND pm.user_id = $2',
      forUpdate ? 'FOR UPDATE OF p, pm' : '',
    ), [projectId, userId]);
  }

  async function requireProjectMember(projectId, userId, forUpdate = false) {
    const project = await getMemberProject(projectId, userId, forUpdate);
    if (!project) notFound();
    return project;
  }

  async function requireProjectOwner(projectId, userId, forUpdate = false) {
    const project = await requireProjectMember(projectId, userId, forUpdate);
    if (project.owner_id !== userId) forbidden('只有專案擁有者可以執行這個操作');
    return project;
  }

  async function lockProject(projectId) {
    const project = await database.one('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
    if (!project) notFound();
    return project;
  }

  async function requireOwnDevice(deviceId, userId, forUpdate = false) {
    const device = await database.one(
      'SELECT * FROM devices WHERE id = $1 AND user_id = $2' + (forUpdate ? ' FOR UPDATE' : ''),
      [deviceId, userId],
    );
    if (!device) notFound();
    return device;
  }

  async function requireRun(id, userId, forUpdate = false) {
    const run = await database.one('SELECT * FROM runs WHERE id = $1' + (forUpdate ? ' FOR UPDATE' : ''), [id]);
    if (!run) notFound();
    await requireProjectMember(run.project_id, userId, forUpdate);
    return run;
  }

  async function requireRunOwner(id, userId, forUpdate = false) {
    const run = await requireRun(id, userId, forUpdate);
    if (run.owner_user_id !== userId) forbidden('只有建立這個任務的使用者可以更新它');
    return run;
  }

  async function requireDispatchParty(id, userId, forUpdate = false) {
    const dispatch = await database.one(sql(
      'SELECT * FROM dispatches WHERE id = $1 AND (sender_user_id = $2 OR target_user_id = $2)',
      forUpdate ? 'FOR UPDATE' : '',
    ), [id, userId]);
    if (!dispatch) notFound();
    const membership = await database.one(
      'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2' + (forUpdate ? ' FOR UPDATE' : ''),
      [dispatch.project_id, userId],
    );
    if (!membership) notFound();
    return dispatch;
  }

  async function cancelProjectDispatches(projectId, queue, { removedUserId = null, targetDeviceId = null } = {}) {
    const clauses = ["project_id = $2", "status IN ('pending', 'accepted')"];
    const values = [now(), projectId];
    if (removedUserId) {
      values.push(removedUserId);
      clauses.push('(sender_user_id = $' + values.length + ' OR target_user_id = $' + values.length + ')');
    }
    if (targetDeviceId) {
      values.push(targetDeviceId);
      clauses.push('target_device_id = $' + values.length);
    }
    const rows = await database.many(
      'UPDATE dispatches SET status = \'cancelled\', updated_at = $1, revision = revision + 1 WHERE ' + clauses.join(' AND ') + ' RETURNING *',
      values,
    );
    for (const row of rows) await emitDispatchUpdate(queue, row);
    return rows;
  }

  async function cancelForDevice(deviceId, queue) {
    const projects = await database.many('SELECT DISTINCT project_id FROM dispatches WHERE target_device_id = $1', [deviceId]);
    for (const row of projects) await cancelProjectDispatches(row.project_id, queue, { targetDeviceId: deviceId });
  }

  async function expirePendingDispatches() {
    return mutate(async (queue) => {
      const rows = await database.many(sql(
        'UPDATE dispatches SET status = \'expired\', updated_at = $1, revision = revision + 1',
        'WHERE status = \'pending\' AND expires_at <= $1 RETURNING *',
      ), [now()]);
      for (const row of rows) await emitDispatchUpdate(queue, row);
      return rows;
    });
  }

  async function replaceTasks(runId, tasks) {
    await database.query('DELETE FROM tasks WHERE run_id = $1', [runId]);
    for (const task of tasks) {
      const input = requireObject(task, 'Task');
      const id = requireId(input.id, 'Task ID');
      const title = requireString(input.title, 'Task 標題', { max: 500 });
      const agent = validEnum(requireString(input.agent, 'Task agent', { max: 40 }), TASK_AGENTS, 'Task agent');
      const status = validEnum(requireString(input.status, 'Task 狀態', { max: 40 }), TASK_STATUSES, 'Task 狀態');
      const sources = input.sources === undefined ? [] : safeArray(input.sources, 'Task sources', 100);
      await database.query(sql(
        'INSERT INTO tasks (id, run_id, parent_task_id, title, agent, status, provider, model, result, sources_json, error, started_at, finished_at)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      ), [
        id, runId, optionalString(input.parentTaskId, 'parentTaskId', { max: 160 }), title, agent, status,
        optionalString(input.provider, 'provider', { max: 80 }), optionalString(input.model, 'model', { max: 160 }),
        optionalString(input.result, 'Task result', { max: 1_000_000, trim: false }), JSON.stringify(sources),
        optionalString(input.error, 'Task error', { max: 20_000, trim: false }),
        input.startedAt === undefined ? null : validTimestamp(input.startedAt, null),
        input.finishedAt === undefined ? null : validTimestamp(input.finishedAt, null),
      ]);
    }
  }

  async function transitionDispatch(id, userId, targetStatus, options = {}) {
    // 先把到期的派工標記掉，過期後不可再接受
    await expirePendingDispatches();
    const snapshot = await requireDispatchParty(id, userId);
    if (options.targetOnly && snapshot.target_user_id !== userId) notFound();
    if (!canTransitionDispatch(snapshot.status, targetStatus)) stateError();
    return mutate(async (queue) => {
      const live = await requireDispatchParty(id, userId, true);
      if (options.targetOnly && live.target_user_id !== userId) notFound();
      if (live.status === 'pending' && live.expires_at <= now()) stateError();
      await (options.validate ?? (async () => {}))(live);
      const assignments = ['status = $1'];
      const values = [targetStatus];
      for (const field of options.fields ?? []) {
        values.push(field.value);
        assignments.push(field.column + ' = $' + values.length);
      }
      values.push(now());
      assignments.push('updated_at = $' + values.length);
      values.push(id, snapshot.revision, snapshot.status);
      const base = values.length - 2;
      const updated = await database.one(
        'UPDATE dispatches SET ' + assignments.join(', ') + ', revision = revision + 1 '
          + 'WHERE id = $' + base + ' AND revision = $' + (base + 1) + ' AND status = $' + (base + 2) + ' RETURNING *',
        values,
      );
      if (!updated) stateError();
      await emitDispatchUpdate(queue, updated);
      return updated;
    });
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
    const digest = tokenHash(token);
    const row = await database.one(sql(
      'SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id',
      'WHERE t.token_hash = $1',
    ), [digest]);
    if (!row) unauthorized();
    request.user = userJson(row);
    request.tokenHash = digest;
    next();
  });

  app.post('/api/auth/register', asyncRoute(async (request, response) => {
    enforceRate('auth', request.ip);
    const body = requireObject(request.body);
    const user = {
      id: newId(),
      email: normalizedEmail(body.email),
      displayName: requireString(body.displayName, '顯示名稱', { max: 80 }),
      createdAt: now(),
    };
    const password = requireString(body.password, '密碼', { min: 10, max: 1024, trim: false });
    const token = opaqueToken();
    try {
      await database.transaction(async () => {
        await database.query(
          'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)',
          [user.id, user.email, await hashPassword(password), user.displayName, user.createdAt],
        );
        await database.query(
          'INSERT INTO auth_tokens (token_hash, user_id, created_at) VALUES ($1, $2, $3)',
          [tokenHash(token), user.id, user.createdAt],
        );
      });
    } catch (error) {
      if (error?.code === '23505') fail(409, 'conflict', '這個 Email 已註冊');
      throw error;
    }
    response.status(201).json({ token, user });
  }));

  app.post('/api/auth/login', asyncRoute(async (request, response) => {
    enforceRate('auth', request.ip);
    const body = requireObject(request.body);
    const email = normalizedEmail(body.email);
    const password = requireString(body.password, '密碼', { min: 1, max: 1024, trim: false });
    const row = await database.one('SELECT * FROM users WHERE email = $1', [email]);
    if (!(row && await verifyPassword(password, row.password_hash))) fail(401, 'invalid_credentials', 'Email 或密碼錯誤');
    const token = opaqueToken();
    await database.query('INSERT INTO auth_tokens (token_hash, user_id, created_at) VALUES ($1, $2, $3)', [tokenHash(token), row.id, now()]);
    response.json({ token, user: userJson(row) });
  }));

  app.post('/api/auth/logout', authenticate, asyncRoute(async (request, response) => {
    await database.query('DELETE FROM auth_tokens WHERE token_hash = $1', [request.tokenHash]);
    response.status(204).end();
  }));

  app.get('/api/me', authenticate, (request, response) => response.json({ user: request.user }));

  app.put('/api/devices/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '裝置 ID');
    const body = requireObject(request.body);
    const name = requireString(body.name, '裝置名稱', { max: 120 });
    const platform = requireString(body.platform, '平台', { max: 80 });
    const time = now();
    const existing = await database.one('SELECT * FROM devices WHERE id = $1', [id]);
    if (existing && existing.user_id !== request.user.id) notFound();
    if (existing) {
      await database.query('UPDATE devices SET name = $1, platform = $2, updated_at = $3, last_seen_at = $3 WHERE id = $4', [name, platform, time, id]);
    } else {
      const inserted = await database.one(sql(
        'INSERT INTO devices (id, user_id, name, platform, accept_remote, last_seen_at, created_at, updated_at)',
        'VALUES ($1, $2, $3, $4, \'ask\', $5, $5, $5) ON CONFLICT (id) DO NOTHING RETURNING id',
      ), [id, request.user.id, name, platform, time]);
      if (!inserted) notFound();
    }
    const device = await database.one(sql(
      'SELECT d.*, u.display_name AS owner_name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = $1',
    ), [id]);
    response.json({ device: deviceJson(device, isOnline(id), request.user.id) });
  }));

  app.get('/api/devices', authenticate, asyncRoute(async (request, response) => {
    const rows = await database.many(sql(
      'SELECT DISTINCT d.*, u.display_name AS owner_name FROM devices d JOIN users u ON u.id = d.user_id',
      'WHERE d.user_id = $1 OR EXISTS (',
      'SELECT 1 FROM project_members mine JOIN project_members peer ON peer.project_id = mine.project_id',
      'WHERE mine.user_id = $1 AND peer.user_id = d.user_id',
      ') ORDER BY d.updated_at DESC',
    ), [request.user.id]);
    response.json({ devices: rows.map((row) => deviceJson(row, isOnline(row.id), request.user.id)) });
  }));

  app.patch('/api/devices/:id', authenticate, asyncRoute(async (request, response) => {
    const device = await requireOwnDevice(requireId(request.params.id, '裝置 ID'), request.user.id);
    const body = requireObject(request.body);
    if (body.name === undefined && body.acceptRemote === undefined) fail(400, 'invalid_input', '至少要提供一個可更新欄位');
    const name = body.name === undefined ? device.name : requireString(body.name, '裝置名稱', { max: 120 });
    const acceptRemote = body.acceptRemote === undefined
      ? device.accept_remote
      : validEnum(requireString(body.acceptRemote, 'acceptRemote', { max: 20 }), new Set(['off', 'ask', 'auto']), 'acceptRemote');
    const time = now();
    await database.query('UPDATE devices SET name = $1, accept_remote = $2, updated_at = $3, last_seen_at = $3 WHERE id = $4', [name, acceptRemote, time, device.id]);
    const row = await database.one('SELECT d.*, u.display_name AS owner_name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = $1', [device.id]);
    response.json({ device: deviceJson(row, isOnline(row.id), request.user.id) });
  }));

  app.delete('/api/devices/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '裝置 ID');
    await mutate(async (queue) => {
      const device = await requireOwnDevice(id, request.user.id, true);
      await cancelForDevice(device.id, queue);
      await database.query('DELETE FROM devices WHERE id = $1', [device.id]);
    });
    streams.delete(id);
    response.status(204).end();
  }));

  app.get('/api/stream', authenticate, asyncRoute(async (request, response) => {
    const deviceId = requireId(request.query.deviceId, 'deviceId');
    await requireOwnDevice(deviceId, request.user.id);
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
    await mutate(async (queue) => {
      await database.query('UPDATE devices SET last_seen_at = $1 WHERE id = $2', [time, deviceId]);
      if (!wasOnline) await emitPresence(queue, deviceId, true, time);
    });
    const replay = await database.many(sql(
      'SELECT e.seq, e.type, e.payload_json, e.created_at FROM sse_events e JOIN sse_deliveries d ON d.seq = e.seq',
      'WHERE d.device_id = $1 AND e.seq > $2 AND (e.project_id IS NULL OR EXISTS (',
      'SELECT 1 FROM project_members pm WHERE pm.project_id = e.project_id AND pm.user_id = $3',
      ')) ORDER BY e.seq ASC',
    ), [deviceId, since, request.user.id]);
    for (const event of replay) {
      const payload = parseJson(event.payload_json, {});
      if (event.type !== 'device_presence' || await canSeeDevice(request.user.id, payload.deviceId)) {
        writeSse(response, { seq: event.seq, type: event.type, payload, createdAt: event.created_at });
      }
    }
    response.write(': connected\n\n');
    const heartbeat = setInterval(() => {
      try { response.write(': keepalive\n\n'); } catch { /* close handles cleanup */ }
    }, 25_000);
    heartbeat.unref?.();
    let closed = false;
    request.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      const current = streams.get(deviceId);
      if (!current) return;
      current.delete(response);
      if (current.size !== 0) return;
      streams.delete(deviceId);
      if (closing) return;
      const lastSeenAt = now();
      void mutate(async (queue) => {
        await database.query('UPDATE devices SET last_seen_at = $1 WHERE id = $2', [lastSeenAt, deviceId]);
        await emitPresence(queue, deviceId, false, lastSeenAt);
      }).catch(() => {});
    });
  }));

  app.get('/api/vault', authenticate, asyncRoute(async (request, response) => {
    response.json({ vault: vaultJson(await database.one('SELECT * FROM vaults WHERE user_id = $1', [request.user.id])) });
  }));

  app.put('/api/vault', authenticate, asyncRoute(async (request, response) => {
    const input = parseVault(request.body);
    const row = await mutate(async (queue) => {
      await database.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [request.user.id]);
      const existing = await database.one('SELECT * FROM vaults WHERE user_id = $1 FOR UPDATE', [request.user.id]);
      if ((existing?.version ?? 0) !== input.expectedVersion) fail(409, 'conflict', '保險箱版本已變更，請重新取得後再試');
      const time = now();
      const version = input.expectedVersion + 1;
      const updated = existing
        ? await database.one(sql(
          'UPDATE vaults SET version = $1, kdf_json = $2, salt = $3, iv = $4, ciphertext = $5, updated_at = $6',
          'WHERE user_id = $7 AND version = $8 RETURNING *',
        ), [version, JSON.stringify(input.kdf), input.salt, input.iv, input.ciphertext, time, request.user.id, input.expectedVersion])
        : await database.one(sql(
          'INSERT INTO vaults (user_id, version, kdf_json, salt, iv, ciphertext, updated_at)',
          'VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id) DO NOTHING RETURNING *',
        ), [request.user.id, version, JSON.stringify(input.kdf), input.salt, input.iv, input.ciphertext, time]);
      if (!updated) fail(409, 'conflict', '保險箱版本已變更，請重新取得後再試');
      await queue('vault_update', { version: updated.version, updatedAt: updated.updated_at }, await userDeviceIds([request.user.id]));
      return updated;
    });
    response.json({ vault: vaultJson(row) });
  }));

  app.delete('/api/vault', authenticate, asyncRoute(async (request, response) => {
    await mutate(async (queue) => {
      await database.query('DELETE FROM vaults WHERE user_id = $1', [request.user.id]);
      await queue('vault_update', { version: null, updatedAt: now() }, await userDeviceIds([request.user.id]));
    });
    response.status(204).end();
  }));

  app.put('/api/projects/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '專案 ID');
    const body = requireObject(request.body);
    const name = requireString(body.name, '專案名稱', { max: 200 });
    const description = requireString(body.description ?? '', '專案說明', { min: 0, max: 20_000, trim: false });
    const project = await mutate(async (queue) => {
      const existing = await database.one('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [id]);
      const time = now();
      if (existing) {
        await requireProjectOwner(id, request.user.id, true);
        await database.query('UPDATE projects SET name = $1, description = $2, updated_at = $3 WHERE id = $4', [name, description, time, id]);
      } else {
        await database.query('INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)', [id, request.user.id, name, description, time]);
        await database.query('INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ($1, $2, \'owner\', $3)', [id, request.user.id, time]);
      }
      const result = await requireProjectMember(id, request.user.id);
      await emitProject(queue, id, 'run_update', { projectId: id, action: 'project_updated' });
      return result;
    });
    response.json({ project: projectJson(project) });
  }));

  app.get('/api/projects', authenticate, asyncRoute(async (request, response) => {
    const rows = await database.many(sql(
      'SELECT p.*, pm.role FROM projects p JOIN project_members pm ON pm.project_id = p.id',
      'WHERE pm.user_id = $1 ORDER BY p.updated_at DESC',
    ), [request.user.id]);
    response.json({ projects: rows.map(projectJson) });
  }));

  app.delete('/api/projects/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '專案 ID');
    await requireProjectOwner(id, request.user.id);
    await database.query('DELETE FROM projects WHERE id = $1', [id]);
    response.status(204).end();
  }));

  app.post('/api/projects/:id/invites', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    await requireProjectOwner(projectId, request.user.id);
    const code = opaqueToken();
    const expiresAt = now() + INVITE_EXPIRY_MS;
    await database.query('INSERT INTO invites (code_hash, project_id, expires_at, used_at) VALUES ($1, $2, $3, NULL)', [tokenHash(code), projectId, expiresAt]);
    response.status(201).json({ code, expiresAt });
  }));

  app.post('/api/invites/accept', authenticate, asyncRoute(async (request, response) => {
    const code = requireString(requireObject(request.body).code, '邀請碼', { max: 300, trim: false });
    const project = await mutate(async (queue) => {
      const invite = await database.one('SELECT * FROM invites WHERE code_hash = $1 FOR UPDATE', [tokenHash(code)]);
      if (!invite || invite.used_at || invite.expires_at <= now()) notFound();
      const source = await database.one('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [invite.project_id]);
      if (!source) notFound();
      const consumed = await database.one(sql(
        'UPDATE invites SET used_at = $1 WHERE code_hash = $2 AND used_at IS NULL AND expires_at > $1',
        'RETURNING project_id',
      ), [now(), invite.code_hash]);
      if (!consumed) notFound();
      await database.query(sql(
        'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ($1, $2, \'member\', $3)',
        'ON CONFLICT (project_id, user_id) DO NOTHING',
      ), [source.id, request.user.id, now()]);
      const result = await requireProjectMember(source.id, request.user.id);
      await emitProject(queue, result.id, 'member_update', { projectId: result.id, userId: request.user.id, action: 'joined' });
      return result;
    });
    response.json({ project: projectJson(project) });
  }));

  app.get('/api/projects/:id/members', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    await requireProjectMember(projectId, request.user.id);
    const members = (await database.many(sql(
      'SELECT pm.user_id, pm.role, u.display_name, u.email FROM project_members pm',
      'JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY pm.created_at ASC',
    ), [projectId])).map((row) => ({
      userId: row.user_id, displayName: row.display_name, email: row.email, role: row.role,
    }));
    response.json({ members });
  }));

  app.delete('/api/projects/:id/members/:userId', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    const userId = requireId(request.params.userId, '使用者 ID');
    await mutate(async (queue) => {
      const project = await lockProject(projectId);
      const caller = await database.one('SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE', [projectId, request.user.id]);
      if (!caller) notFound();
      const target = await database.one('SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE', [projectId, userId]);
      if (!target) notFound();
      if (userId !== request.user.id && project.owner_id !== request.user.id) forbidden('只有擁有者可以移除其他成員');
      if (target.role === 'owner') fail(400, 'invalid_input', '專案擁有者不能離開專案，請改為刪除專案');
      await database.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await cancelProjectDispatches(projectId, queue, { removedUserId: userId });
      await emitProject(queue, projectId, 'member_update', { projectId, userId, action: 'removed' });
    });
    response.status(204).end();
  }));

  app.put('/api/runs/:id', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, 'Run ID');
    const input = parseRunInput(request.body, id, now);
    const output = await mutate(async (queue) => {
      const existing = await database.one('SELECT * FROM runs WHERE id = $1 FOR UPDATE', [id]);
      if (existing && existing.project_id !== input.projectId) fail(409, 'conflict', 'Run 不可移到其他專案');
      await lockProject(input.projectId);
      if (existing) await requireRunOwner(id, request.user.id, true);
      else await requireProjectMember(input.projectId, request.user.id, true);
      if (input.deviceId) await requireOwnDevice(input.deviceId, request.user.id, true);
      const time = now();
      if (existing) {
        await database.query(sql(
          'UPDATE runs SET device_id = $1, goal = $2, status = $3, mode = $4, plan_summary = $5, final_result = $6, error = $7,',
          'cost_usd = $8, input_tokens = $9, output_tokens = $10, finished_at = $11, updated_at = $12 WHERE id = $13',
        ), [input.deviceId, input.goal, input.status, input.mode, input.planSummary, input.finalResult, input.error,
          input.costUsd, input.inputTokens, input.outputTokens, input.finishedAt, time, id]);
      } else {
        await database.query(sql(
          'INSERT INTO runs (id, project_id, owner_user_id, device_id, goal, status, mode, plan_summary, final_result, error, cost_usd, input_tokens, output_tokens, created_at, finished_at, updated_at)',
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
        ), [id, input.projectId, request.user.id, input.deviceId, input.goal, input.status, input.mode, input.planSummary,
          input.finalResult, input.error, input.costUsd, input.inputTokens, input.outputTokens, input.createdAt, input.finishedAt, time]);
      }
      await replaceTasks(id, input.tasks);
      const run = await database.one('SELECT * FROM runs WHERE id = $1', [id]);
      const tasks = await database.many('SELECT * FROM tasks WHERE run_id = $1', [id]);
      await emitProject(queue, run.project_id, 'run_update', { runId: id, status: run.status });
      return { run, tasks };
    });
    response.json({ run: { ...runJson(output.run, { full: true }), tasks: output.tasks.map(taskJson) } });
  }));

  app.post('/api/runs/:id/events', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, 'Run ID');
    const events = safeArray(requireObject(request.body).events, 'events', 200);
    const accepted = await mutate(async (queue) => {
      const run = await requireRunOwner(id, request.user.id, true);
      let count = 0;
      for (const item of events) {
        const event = requireObject(item, 'Event');
        if (event.runId !== undefined && event.runId !== run.id) fail(400, 'invalid_input', 'Event runId 與路徑不一致');
        const seq = requireFiniteNumber(event.seq, 'Event seq', { min: 0, max: 2_147_483_647 });
        if (!Number.isInteger(seq)) fail(400, 'invalid_input', 'Event seq 必須是整數');
        const type = requireString(event.type, 'Event type', { max: 100 });
        const payload = requireObject(event.payload ?? {}, 'Event payload');
        assertNoSensitiveFields(payload);
        const inserted = await database.one(sql(
          'INSERT INTO run_events (run_id, seq, type, payload_json, created_at) VALUES ($1, $2, $3, $4, $5)',
          'ON CONFLICT (run_id, seq) DO NOTHING RETURNING seq',
        ), [run.id, seq, type, JSON.stringify(payload), validTimestamp(event.createdAt, now())]);
        if (inserted) count += 1;
      }
      if (count) await emitProject(queue, run.project_id, 'run_update', { runId: run.id, eventCount: count });
      return count;
    });
    response.json({ accepted });
  }));

  app.put('/api/runs/:id/artifacts/:artifactId', authenticate, asyncRoute(async (request, response) => {
    const runId = requireId(request.params.id, 'Run ID');
    const artifactId = requireId(request.params.artifactId, 'Artifact ID');
    const body = requireObject(request.body);
    assertNoSensitiveFields(body);
    if (body.id !== undefined && body.id !== artifactId) fail(400, 'invalid_input', 'Artifact ID 與路徑不一致');
    if (body.runId !== undefined && body.runId !== runId) fail(400, 'invalid_input', 'Artifact runId 與路徑不一致');
    const name = requireString(body.name, 'Artifact 名稱', { max: 300 });
    const kind = validEnum(requireString(body.kind, 'Artifact kind', { max: 30 }), ARTIFACT_KINDS, 'Artifact kind');
    const content = requireString(body.content, 'Artifact content', { min: 0, max: MAX_ARTIFACT_BYTES, trim: false });
    if (Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES) fail(413, 'too_large', 'Artifact 超過 5 MB');
    const createdBy = optionalString(body.createdBy, 'createdBy', { max: 80 });
    const artifact = await mutate(async (queue) => {
      const run = await requireRunOwner(runId, request.user.id, true);
      const prior = await database.one('SELECT run_id FROM artifacts WHERE id = $1 FOR UPDATE', [artifactId]);
      if (prior && prior.run_id !== run.id) notFound();
      const time = now();
      const saved = await database.one(sql(
        'INSERT INTO artifacts (id, run_id, name, kind, content, created_by, created_at, updated_at)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $7)',
        'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, content = EXCLUDED.content,',
        'created_by = EXCLUDED.created_by, updated_at = EXCLUDED.updated_at RETURNING *',
      ), [artifactId, run.id, name, kind, content, createdBy, time]);
      await emitProject(queue, run.project_id, 'run_update', { runId: run.id, artifactId });
      return saved;
    });
    response.json({ artifact: artifactJson(artifact) });
  }));

  app.get('/api/projects/:id/runs', authenticate, asyncRoute(async (request, response) => {
    const projectId = requireId(request.params.id, '專案 ID');
    await requireProjectMember(projectId, request.user.id);
    response.json({ runs: (await database.many('SELECT * FROM runs WHERE project_id = $1 ORDER BY created_at DESC', [projectId])).map(runJson) });
  }));

  app.get('/api/runs/:id', authenticate, asyncRoute(async (request, response) => {
    const run = await requireRun(requireId(request.params.id, 'Run ID'), request.user.id);
    const tasks = await database.many('SELECT * FROM tasks WHERE run_id = $1', [run.id]);
    const events = (await database.many('SELECT * FROM run_events WHERE run_id = $1 ORDER BY seq ASC', [run.id])).map((row) => {
      const payload = parseJson(row.payload_json, {});
      if (run.owner_user_id !== request.user.id && row.type === 'tool_call' && payload && typeof payload === 'object') {
        const { args: ignored, ...redacted } = payload;
        return { seq: row.seq, runId: row.run_id, type: row.type, payload: { ...redacted, argsRedacted: true }, createdAt: row.created_at };
      }
      return { seq: row.seq, runId: row.run_id, type: row.type, payload, createdAt: row.created_at };
    });
    const artifacts = await database.many('SELECT * FROM artifacts WHERE run_id = $1 ORDER BY created_at ASC', [run.id]);
    response.json({ run: { ...runJson(run, { full: true }), tasks: tasks.map(taskJson), events, artifacts: artifacts.map(artifactJson) } });
  }));

  app.post('/api/dispatches', authenticate, asyncRoute(async (request, response) => {
    await expirePendingDispatches();
    enforceRate('dispatch', request.user.id);
    const body = requireObject(request.body);
    assertNoSensitiveFields(body);
    const id = requireId(body.id, '派工 ID');
    const projectId = requireId(body.projectId, 'projectId');
    const targetDeviceId = requireId(body.targetDeviceId, 'targetDeviceId');
    const senderDeviceId = body.senderDeviceId === undefined || body.senderDeviceId === null ? null : requireId(body.senderDeviceId, 'senderDeviceId');
    const goal = requireString(body.goal, 'goal', { max: 20 * 1024, trim: false });
    if (Buffer.byteLength(goal, 'utf8') > 20 * 1024) fail(413, 'too_large', 'goal 超過 20 KB');
    const context = safeArray(body.context ?? [], 'context', 500);
    if (jsonByteLength(context) > 200 * 1024) fail(413, 'too_large', 'context 超過 200 KB');
    const optionsValue = body.options === undefined ? {} : requireObject(body.options, 'options');
    const parent = body.parent === undefined || body.parent === null ? null : requireObject(body.parent, 'parent');
    const dispatch = await mutate(async (queue) => {
      await lockProject(projectId);
      const senderMembership = await database.one('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE', [projectId, request.user.id]);
      if (!senderMembership) notFound();
      const target = await database.one('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [targetDeviceId]);
      if (!target) notFound();
      const targetMembership = await database.one('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE', [projectId, target.user_id]);
      if (target.user_id !== request.user.id && !targetMembership) notFound();
      if (target.accept_remote === 'off') forbidden('目標裝置目前不接受遠端派工');
      if (senderDeviceId) await requireOwnDevice(senderDeviceId, request.user.id, true);
      const sender = await database.one('SELECT * FROM users WHERE id = $1', [request.user.id]);
      const time = now();
      const inserted = await database.one(sql(
        'INSERT INTO dispatches (id, project_id, target_device_id, target_user_id, sender_user_id, sender_name, sender_device_id, cross_account, goal, context_json, options_json, parent_json, status, run_id, summary, result, sources_json, error, cost_usd, created_at, updated_at, expires_at)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, \'pending\', NULL, NULL, NULL, \'[]\', NULL, 0, $13, $13, $14)',
        'ON CONFLICT (id) DO NOTHING RETURNING *',
      ), [id, projectId, target.id, target.user_id, request.user.id, sender.display_name, senderDeviceId,
        target.user_id !== request.user.id, goal, JSON.stringify(context), JSON.stringify(optionsValue), parent ? JSON.stringify(parent) : null,
        time, time + DISPATCH_EXPIRY_MS]);
      if (!inserted) fail(409, 'conflict', '派工 ID 已存在');
      await queue('dispatch_created', { dispatch: dispatchJson(inserted) }, [target.id], projectId);
      return inserted;
    });
    response.status(201).json({ dispatch: dispatchJson(dispatch) });
  }));

  app.get('/api/dispatches', authenticate, asyncRoute(async (request, response) => {
    await expirePendingDispatches();
    const role = requireString(request.query.role, 'role', { max: 20 });
    if (!['incoming', 'outgoing'].includes(role)) fail(400, 'invalid_input', 'role 必須是 incoming 或 outgoing');
    const status = request.query.status === undefined ? null : requireString(request.query.status, 'status', { max: 20 });
    const column = role === 'incoming' ? 'target_user_id' : 'sender_user_id';
    const base = 'SELECT d.* FROM dispatches d JOIN project_members pm ON pm.project_id = d.project_id WHERE d.' + column + ' = $1 AND pm.user_id = $1';
    const rows = status
      ? await database.many(base + ' AND d.status = $2 ORDER BY d.created_at DESC', [request.user.id, status])
      : await database.many(base + ' ORDER BY d.created_at DESC', [request.user.id]);
    response.json({ dispatches: rows.map(dispatchJson) });
  }));

  app.get('/api/dispatches/:id', authenticate, asyncRoute(async (request, response) => {
    await expirePendingDispatches();
    const dispatch = await requireDispatchParty(requireId(request.params.id, '派工 ID'), request.user.id);
    const messages = await database.many('SELECT * FROM dispatch_messages WHERE dispatch_id = $1 ORDER BY created_at ASC', [dispatch.id]);
    response.json({ dispatch: dispatchJson(dispatch), messages: messages.map(messageJson) });
  }));

  app.post('/api/dispatches/:id/accept', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '派工 ID');
    const runId = requireId(requireObject(request.body).runId, 'runId');
    const dispatch = await transitionDispatch(id, request.user.id, 'accepted', {
      targetOnly: true,
      fields: [{ column: 'run_id', value: runId }],
      validate: async (live) => {
        const target = live.target_device_id ? await requireOwnDevice(live.target_device_id, request.user.id, true) : null;
        if (!target || target.accept_remote === 'off') forbidden('目標裝置目前不接受遠端派工');
      },
    });
    response.json({ dispatch: dispatchJson(dispatch) });
  }));

  app.post('/api/dispatches/:id/reject', authenticate, asyncRoute(async (request, response) => {
    const reason = optionalString(requireObject(request.body).reason, 'reason', { max: 20_000, trim: false });
    const dispatch = await transitionDispatch(requireId(request.params.id, '派工 ID'), request.user.id, 'rejected', {
      targetOnly: true, fields: [{ column: 'error', value: reason }],
    });
    response.json({ dispatch: dispatchJson(dispatch) });
  }));

  app.post('/api/dispatches/:id/report', authenticate, asyncRoute(async (request, response) => {
    const id = requireId(request.params.id, '派工 ID');
    const body = requireObject(request.body);
    const status = validEnum(requireString(body.status, 'status', { max: 20 }), new Set(['done', 'partial', 'failed']), 'status');
    const runId = requireId(body.runId, 'runId');
    const summary = optionalString(body.summary, 'summary', { max: 100_000, trim: false });
    const result = optionalString(body.result, 'result', { max: 2_000_000, trim: false });
    const sources = body.sources === undefined ? [] : safeArray(body.sources, 'sources', 200);
    const error = optionalString(body.error, 'error', { max: 50_000, trim: false });
    const costUsd = body.costUsd === undefined ? 0 : requireFiniteNumber(body.costUsd, 'costUsd', { min: 0, max: 1_000_000 });
    const dispatch = await transitionDispatch(id, request.user.id, status, {
      targetOnly: true,
      fields: [
        { column: 'run_id', value: runId }, { column: 'summary', value: summary }, { column: 'result', value: result },
        { column: 'sources_json', value: JSON.stringify(sources) }, { column: 'error', value: error }, { column: 'cost_usd', value: costUsd },
      ],
      validate: async (live) => {
        const run = await database.one('SELECT * FROM runs WHERE id = $1 AND project_id = $2 AND owner_user_id = $3', [runId, live.project_id, request.user.id]);
        if (!run) fail(400, 'invalid_input', 'runId 必須是目標使用者在同一專案的任務');
      },
    });
    response.json({ dispatch: dispatchJson(dispatch) });
  }));

  app.post('/api/dispatches/:id/cancel', authenticate, asyncRoute(async (request, response) => {
    const dispatch = await transitionDispatch(requireId(request.params.id, '派工 ID'), request.user.id, 'cancelled');
    response.json({ dispatch: dispatchJson(dispatch) });
  }));

  app.post('/api/dispatches/:id/messages', authenticate, asyncRoute(async (request, response) => {
    const dispatchId = requireId(request.params.id, '派工 ID');
    const body = requireObject(request.body);
    const id = requireId(body.id, '訊息 ID');
    const kind = validEnum(requireString(body.kind, '訊息類型', { max: 20 }), MESSAGE_KINDS, '訊息類型');
    const text = requireString(body.text, '訊息內容', { max: 20 * 1024, trim: false });
    if (Buffer.byteLength(text, 'utf8') > 20 * 1024) fail(413, 'too_large', '訊息內容超過 20 KB');
    const replyTo = optionalString(body.replyTo, 'replyTo', { max: 160 });
    const message = await mutate(async (queue) => {
      const dispatch = await requireDispatchParty(dispatchId, request.user.id, true);
      if (TERMINAL.has(dispatch.status)) stateError('派工已結束，不能再傳送訊息');
      const fromDeviceId = request.user.id === dispatch.target_user_id ? dispatch.target_device_id : dispatch.sender_device_id;
      const inserted = await database.one(sql(
        'INSERT INTO dispatch_messages (id, dispatch_id, from_user_id, from_device_id, kind, text, reply_to, created_at)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING *',
      ), [id, dispatch.id, request.user.id, fromDeviceId, kind, text, replyTo, now()]);
      if (!inserted) {
        const existing = await database.one('SELECT * FROM dispatch_messages WHERE id = $1', [id]);
        if (!existing || existing.dispatch_id !== dispatch.id) fail(409, 'conflict', '訊息 ID 已用於其他派工');
        return existing;
      }
      await queue('dispatch_message', { dispatchId: dispatch.id, message: messageJson(inserted) },
        await userDeviceIds(await activeDispatchParties(dispatch)), dispatch.project_id);
      return inserted;
    });
    response.status(201).json({ message: messageJson(message) });
  }));

  app.use((request, _response, next) => next(new ApiError(404, 'not_found', '找不到資源')));
  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) return response.status(413).json({ error: { code: 'too_large', message: '請求內容太大' } });
    if (error?.type === 'entity.parse.failed') return response.status(400).json({ error: { code: 'invalid_input', message: 'JSON 格式不正確' } });
    return jsonError(response, error);
  });

  const expiryTimer = setInterval(() => { void expirePendingDispatches().catch(() => {}); }, 30_000);
  expiryTimer.unref?.();
  app.locals.database = database;
  app.locals.close = async () => {
    closing = true;
    clearInterval(expiryTimer);
    for (const responses of streams.values()) for (const response of responses) response.end();
    streams.clear();
    if (ownsDatabase) await database.close();
  };
  app.locals.expirePendingDispatches = expirePendingDispatches;
  app.locals.publicDispatchById = async (id) => {
    const row = await database.one('SELECT * FROM dispatches WHERE id = $1', [id]);
    return row ? dispatchJson(row) : null;
  };
  return app;
}
