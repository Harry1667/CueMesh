import { describe, expect, it, vi } from 'vitest';
import { getDemoDetail } from '../data/demo';
import { demoDispatchDetail } from '../data/teamDemo';
import {
  normalizeDetail,
  RuntimeConfigSchema,
  EventSchema,
  RegisterRequestSchema,
  SendMessageSchema,
} from './contracts';
import { WebsiteApi, safeSourceUrl, sandboxDocument } from './api';
import { resolveLocale } from './preferences';

const config = RuntimeConfigSchema.parse({ dataMode: 'live' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const client = (request: typeof fetch, unauthorized = () => {}) =>
  new WebsiteApi(
    config,
    request,
    () => 'fixture-account-token',
    unauthorized,
    () => 'zh-TW',
  );
describe('cloud v1 data boundaries', () => {
  it('sorts and deduplicates events without changing partial status', () => {
    const value = getDemoDetail('demo-run-2');
    value.events = [value.events[2], value.events[0], value.events[2]];
    const normalized = normalizeDetail(value, value.run.id);
    expect(normalized.events.map((event) => event.seq)).toEqual([1, 3]);
    expect(normalized.run.status).toBe('partial');
  });
  it('rejects mixed-run records, stale cursors, and duplicate task IDs', () => {
    const value = getDemoDetail('demo-run-1');
    expect(() => normalizeDetail({ ...value, lastEventSeq: 0 }, value.run.id)).toThrow('cursor');
    expect(() =>
      normalizeDetail({ ...value, tasks: [value.tasks[0], value.tasks[0]] }, value.run.id),
    ).toThrow('duplicate');
    value.tasks[0].runId = 'other';
    expect(() => normalizeDetail(value, value.run.id)).toThrow('another run');
  });
  it('recognizes all four mesh events added in v1', () => {
    for (const type of ['mesh_dispatch', 'mesh_report', 'mesh_question', 'mesh_answer'])
      expect(
        EventSchema.parse({ seq: 1, runId: 'run', type, payload: {}, createdAt: 0 }).type,
      ).toBe(type);
  });
  it('rejects invalid enum values and timestamps outside the JavaScript date range', () => {
    const value = getDemoDetail('demo-run-1');
    expect(() =>
      normalizeDetail({ ...value, run: { ...value.run, status: 'success' } }, value.run.id),
    ).toThrow();
    expect(() =>
      normalizeDetail({ ...value, run: { ...value.run, createdAt: 1e16 } }, value.run.id),
    ).toThrow();
  });
  it('enforces the server registration minimum and message UTF-8 byte limit', () => {
    expect(
      RegisterRequestSchema.safeParse({
        email: 'demo@example.com',
        displayName: 'Demo',
        password: 'short',
      }).success,
    ).toBe(false);
    expect(
      SendMessageSchema.safeParse({
        id: 'id',
        kind: 'question',
        text: '字'.repeat(7000),
        replyTo: null,
      }).success,
    ).toBe(false);
  });
});
describe('server-owned account transport', () => {
  it('sends a Bearer token and language, with no cookies or provider credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ projects: [] }));
    expect(await client(request).projects()).toEqual({ projects: [] });
    expect(request).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        credentials: 'omit',
        cache: 'no-store',
        headers: expect.objectContaining({
          Authorization: 'Bearer fixture-account-token',
          'Accept-Language': 'zh-TW',
        }),
      }),
    );
  });
  it('posts registration to the server without a Bearer header', async () => {
    const response = {
      token: 'new-account-token',
      user: { id: 'u', email: 'demo@example.com', displayName: 'Demo', createdAt: 0 },
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(response, 201));
    expect(
      await client(request).register('demo@example.com', 'long-enough-password', 'Demo'),
    ).toEqual(response);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('/api/auth/register');
    expect(options?.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(options?.body))).toEqual({
      email: 'demo@example.com',
      password: 'long-enough-password',
      displayName: 'Demo',
    });
  });
  it('accepts the 204 logout response without trying to parse JSON', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client(request).logout()).resolves.toBeUndefined();
    expect(request.mock.calls[0][0]).toBe('/api/auth/logout');
  });
  it('clears the authenticated session on 401', async () => {
    const clear = vi.fn();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: { code: 'unauthorized', message: 'Session ended' } }, 401));
    await expect(client(request, clear).projects()).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledOnce();
  });
  it('fails live requests explicitly instead of injecting sample data', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    await expect(client(request).projects()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('adapts the documented nested run envelope to the UI model', async () => {
    const detail = getDemoDetail('demo-run-1');
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        run: {
          ...detail.run,
          tasks: detail.tasks,
          events: detail.events,
          artifacts: detail.artifacts,
        },
      }),
    );
    const result = await client(request).detail(detail.run.id);
    expect(result.run.id).toBe(detail.run.id);
    expect(result.lastEventSeq).toBe(6);
    expect(result.artifacts).toHaveLength(2);
  });
  it('rejects another dispatch’s messages', async () => {
    const detail = structuredClone(demoDispatchDetail);
    detail.messages[0].dispatchId = 'other';
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(detail));
    await expect(client(request).dispatch(detail.dispatch.id)).rejects.toMatchObject({
      code: 'contract_mismatch',
    });
  });
  it('preserves the caller message ID for server deduplication', async () => {
    const message = demoDispatchDetail.messages[0];
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ message }, 201));
    const body = {
      id: message.id,
      kind: message.kind,
      text: message.text,
      replyTo: message.replyTo,
    };
    await client(request).sendMessage(message.dispatchId, body);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual(body);
  });
  it('rejects malformed success JSON', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ projects: [{ id: 'incomplete' }] }));
    await expect(client(request).projects()).rejects.toMatchObject({ code: 'contract_mismatch' });
  });
});
describe('browser and content boundaries', () => {
  it('allows same-origin or explicit HTTPS API bases, not credential URLs or public plain HTTP', () => {
    expect(RuntimeConfigSchema.safeParse({ apiBaseUrl: '/api' }).success).toBe(true);
    expect(
      RuntimeConfigSchema.safeParse({ apiBaseUrl: 'https://api.example.com/api' }).success,
    ).toBe(true);
    for (const apiBaseUrl of [
      '//evil.example/api',
      'http://api.example.com/api',
      'https://user:password@api.example/api',
    ])
      expect(RuntimeConfigSchema.safeParse({ apiBaseUrl }).success).toBe(false);
  });
  it('removes dangerous source URL protocols and places a deny-by-default CSP before content', () => {
    expect(safeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(safeSourceUrl('https://example.com/source')).toBe('https://example.com/source');
    const doc = sandboxDocument('<p>Example</p>');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<p>'));
    expect(doc).toContain("script-src 'none'");
    expect(doc).toContain("connect-src 'none'");
  });
  it('respects the browser language list including Chinese script variants', () => {
    expect(resolveLocale(['zh-Hant-HK', 'en-US'])).toBe('zh-TW');
    expect(resolveLocale(['zh-Hans-SG'])).toBe('zh-CN');
    expect(resolveLocale(['fr-CA', 'en'])).toBe('fr');
    expect(resolveLocale(['unknown', 'ja-JP'])).toBe('ja');
    expect(resolveLocale(['unknown'])).toBe('en');
  });
});
