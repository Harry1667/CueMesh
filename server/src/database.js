import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, types } from 'pg';

// PostgreSQL 的 BIGINT 預設是字串；API 契約要求 Unix 毫秒和 SSE seq 為數字。
types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

const SCHEMA_LOCK_KEY = 7_946_201;
const EVENT_ORDER_LOCK_KEY = 7_946_202;
const transactionStorage = new AsyncLocalStorage();

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id);

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    accept_remote TEXT NOT NULL DEFAULT 'ask' CHECK (accept_remote IN ('off', 'ask', 'auto')),
    last_seen_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);

  CREATE TABLE IF NOT EXISTS vaults (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version BIGINT NOT NULL,
    kdf_json TEXT NOT NULL,
    salt TEXT NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at BIGINT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id, project_id);

  CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    used_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    plan_summary TEXT NOT NULL,
    final_result TEXT,
    error TEXT,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    finished_at BIGINT,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runs_project_idx ON runs(project_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    parent_task_id TEXT,
    title TEXT NOT NULL,
    agent TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    result TEXT,
    sources_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    started_at BIGINT,
    finished_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS tasks_run_idx ON tasks(run_id);

  CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (run_id, seq)
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts(run_id);

  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    sender_device_id TEXT,
    cross_account BOOLEAN NOT NULL,
    goal TEXT NOT NULL,
    context_json TEXT NOT NULL,
    options_json TEXT NOT NULL,
    parent_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'done', 'partial', 'failed', 'cancelled', 'expired')),
    run_id TEXT,
    summary TEXT,
    result TEXT,
    sources_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS dispatches_sender_idx ON dispatches(sender_user_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS dispatches_target_idx ON dispatches(target_user_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS dispatches_project_idx ON dispatches(project_id, status);

  CREATE TABLE IF NOT EXISTS dispatch_messages (
    id TEXT PRIMARY KEY,
    dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_device_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('question', 'answer', 'progress')),
    text TEXT NOT NULL,
    reply_to TEXT,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dispatch_messages_dispatch_idx ON dispatch_messages(dispatch_id, created_at);

  CREATE TABLE IF NOT EXISTS sse_events (
    seq BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sse_deliveries (
    seq BIGINT NOT NULL REFERENCES sse_events(seq) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    PRIMARY KEY (seq, device_id)
  );
  CREATE INDEX IF NOT EXISTS sse_deliveries_device_idx ON sse_deliveries(device_id, seq);

  -- 保持與先前 SQLite 版已建立的資料庫相容；CREATE TABLE IF NOT EXISTS 不會補欄位。
  ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
`;

function activeClient(database) {
  const state = transactionStorage.getStore();
  return state?.database === database ? state.client : null;
}

export function createDatabase({ connectionString = process.env.DATABASE_URL, max = 10 } = {}) {
  if (!connectionString) throw new Error('缺少 DATABASE_URL');
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  // pg 的 idle client error 若未處理會讓 process 崩潰；不要記錄含連線字串的原始錯誤。
  pool.on('error', () => {});

  const database = {
    async initialize() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SCHEMA_LOCK_KEY]);
        await client.query(schema);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* 連線可能已中斷 */ }
        throw error;
      } finally {
        client.release();
      }
    },

    async query(text, values = []) {
      const client = activeClient(database);
      return (client ?? pool).query(text, values);
    },

    async one(text, values = []) {
      const result = await database.query(text, values);
      return result.rows[0] ?? null;
    },

    async many(text, values = []) {
      const result = await database.query(text, values);
      return result.rows;
    },

    async transaction(work) {
      if (activeClient(database)) return work(database);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        return await transactionStorage.run({ database, client }, async () => {
          const value = await work(database);
          await client.query('COMMIT');
          return value;
        });
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* 連線可能已中斷 */ }
        throw error;
      } finally {
        client.release();
      }
    },

    async lockEventOrder() {
      if (!activeClient(database)) throw new Error('事件排序鎖必須在資料庫交易內取得');
      // transaction-level lock 直到 COMMIT 才釋放，因此 seq 與可見提交順序一致。
      await database.query('SELECT pg_advisory_xact_lock($1::bigint)', [EVENT_ORDER_LOCK_KEY]);
    },

    async resetForTests() {
      await database.query(`
        TRUNCATE TABLE sse_deliveries, sse_events, dispatch_messages, dispatches, artifacts,
          run_events, tasks, runs, invites, project_members, projects, vaults, devices,
          auth_tokens, users RESTART IDENTITY CASCADE
      `);
    },

    async close() {
      await pool.end();
    },
  };

  return database;
}
