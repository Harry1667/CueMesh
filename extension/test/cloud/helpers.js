import { memoryKv } from '../../src/core/store.js';

export { memoryKv };

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(body); },
  };
}

export function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

export function sseResponse(chunks, signal, { hold = false } = {}) {
  let index = 0;
  let pendingReject = null;
  const abort = () => pendingReject?.(abortError());
  signal?.addEventListener('abort', abort, { once: true });
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index < chunks.length) {
              const value = new TextEncoder().encode(chunks[index]);
              index += 1;
              return { done: false, value };
            }
            if (!hold) return { done: true };
            return new Promise((resolve, reject) => {
              pendingReject = reject;
              signal?.addEventListener('abort', () => reject(abortError()), { once: true });
            });
          },
          releaseLock() {},
        };
      },
    },
  };
}

export async function eventually(check, { timeout = 1000, interval = 5 } = {}) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw lastError ?? new Error('等待逾時');
}

export function fakeStore(keys = { anthropic: 'a-key', openai: 'o-key' }) {
  const data = { ...keys };
  const calls = [];
  const projects = [{ id: 'project-local', name: '本機專案', description: '', createdAt: 1 }];
  return {
    calls,
    keys: { get: (provider) => data[provider] },
    async exportKeys() { return { anthropic: data.anthropic ?? null, openai: data.openai ?? null }; },
    async getKeyStatus() {
      return Object.fromEntries(['anthropic', 'openai'].map((provider) => [provider, { set: Boolean(data[provider]), last4: data[provider]?.slice(-4) ?? null }]));
    },
    async setKey(provider, value) {
      calls.push({ type: 'setKey', provider, value });
      data[provider] = value;
    },
    async removeKey(provider) {
      calls.push({ type: 'removeKey', provider });
      delete data[provider];
    },
    async listProjects() { return structuredClone(projects); },
    async createProject({ name, description }) {
      const project = { id: 'created-' + (projects.length + 1), name, description, createdAt: Date.now() };
      projects.push(project);
      return structuredClone(project);
    },
    async getSettings() { return { maxCostUsd: 2 }; },
    _keys: data,
    _projects: projects,
  };
}
