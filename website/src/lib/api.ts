import { z } from 'zod';
import {
  ApiErrorSchema,
  AuthResponseSchema,
  MeResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ProjectsResponseSchema,
  RunsResponseSchema,
  CloudRunResponseSchema,
  DevicesResponseSchema,
  MembersResponseSchema,
  ProjectResponseSchema,
  ProjectWriteSchema,
  InviteResponseSchema,
  InviteAcceptSchema,
  DispatchesResponseSchema,
  DispatchDetailSchema,
  MessageResponseSchema,
  SendMessageSchema,
  normalizeDetail,
  type RunDetail,
  type RuntimeConfig,
} from './contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'NETWORK_ERROR',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export class WebsiteApi {
  constructor(
    private config: RuntimeConfig,
    private transport: typeof fetch = fetch,
    private getToken: () => string | null = () => null,
    private onUnauthorized: () => void = () => {},
    private getLanguage: () => string = () => 'en',
  ) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestInit = {},
    authenticated = true,
  ): Promise<T> {
    const token = this.getToken();
    if (authenticated && !token) throw new ApiError('Sign in to continue.', 401, 'unauthenticated');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      // 瀏覽器的 fetch 不能用物件方法的形式呼叫，否則會拋 Illegal invocation，請求送不出去
      const transport = this.transport;
      const response = await transport(this.config.apiBaseUrl + path, {
        ...options,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Accept-Language': this.getLanguage(),
          ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
      if (response.status === 401 && authenticated) this.onUnauthorized();
      let body: unknown;
      if (response.status !== 204) {
        try {
          body = await response.json();
        } catch {
          throw new ApiError(
            'The server did not return JSON. Check the API route.',
            response.status,
            'invalid_response',
          );
        }
      }
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(body);
        throw new ApiError(
          parsed.success ? parsed.data.error.message : 'The request could not be completed.',
          response.status,
          parsed.success ? parsed.data.error.code : 'http_error',
        );
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success)
        throw new ApiError(
          'The server response does not match the data contract.',
          response.status,
          'contract_mismatch',
        );
      return parsed.data;
    } catch (error) {
      if (options.signal?.aborted || error instanceof ApiError) throw error;
      throw new ApiError(
        controller.signal.aborted
          ? 'The server took too long to respond. Try again.'
          : 'The website service is unavailable. Your extension can keep working independently.',
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  login(email: string, password: string) {
    return this.request(
      '/auth/login',
      AuthResponseSchema,
      { method: 'POST', body: JSON.stringify(LoginRequestSchema.parse({ email, password })) },
      false,
    );
  }
  register(email: string, password: string, displayName: string) {
    return this.request(
      '/auth/register',
      AuthResponseSchema,
      {
        method: 'POST',
        body: JSON.stringify(RegisterRequestSchema.parse({ email, password, displayName })),
      },
      false,
    );
  }
  logout() {
    return this.request('/auth/logout', z.undefined(), { method: 'POST' });
  }
  me(signal?: AbortSignal) {
    return this.request('/me', MeResponseSchema, { signal });
  }
  projects(signal?: AbortSignal) {
    return this.request('/projects', ProjectsResponseSchema, { signal });
  }
  runs(projectId: string, signal?: AbortSignal) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/runs`, RunsResponseSchema, {
      signal,
    });
  }
  async detail(runId: string, signal?: AbortSignal): Promise<RunDetail> {
    const { run } = await this.request(
      `/runs/${encodeURIComponent(runId)}`,
      CloudRunResponseSchema,
      { signal },
    );
    const { tasks, events, artifacts, ...fields } = run;
    return normalizeDetail(
      {
        run: fields,
        tasks,
        events,
        artifacts,
        lastEventSeq: events.reduce((max, event) => Math.max(max, event.seq), 0),
      },
      runId,
    );
  }
  devices(signal?: AbortSignal) {
    return this.request('/devices', DevicesResponseSchema, { signal });
  }
  members(projectId: string, signal?: AbortSignal) {
    return this.request(
      `/projects/${encodeURIComponent(projectId)}/members`,
      MembersResponseSchema,
      { signal },
    );
  }
  saveProject(projectId: string, name: string, description: string) {
    return this.request(`/projects/${encodeURIComponent(projectId)}`, ProjectResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(ProjectWriteSchema.parse({ name, description })),
    });
  }
  createInvite(projectId: string) {
    return this.request(
      `/projects/${encodeURIComponent(projectId)}/invites`,
      InviteResponseSchema,
      { method: 'POST', body: '{}' },
    );
  }
  acceptInvite(code: string) {
    return this.request('/invites/accept', ProjectResponseSchema, {
      method: 'POST',
      body: JSON.stringify(InviteAcceptSchema.parse({ code })),
    });
  }
  dispatches(role: 'incoming' | 'outgoing', signal?: AbortSignal) {
    return this.request(`/dispatches?role=${role}`, DispatchesResponseSchema, { signal });
  }
  async dispatch(id: string, signal?: AbortSignal) {
    const detail = await this.request(
      `/dispatches/${encodeURIComponent(id)}`,
      DispatchDetailSchema,
      { signal },
    );
    if (detail.dispatch.id !== id || detail.messages.some((message) => message.dispatchId !== id))
      throw new ApiError(
        'The server returned another handoff’s messages.',
        200,
        'contract_mismatch',
      );
    return {
      ...detail,
      messages: [...new Map(detail.messages.map((message) => [message.id, message])).values()].sort(
        (a, b) => a.createdAt - b.createdAt,
      ),
    };
  }
  sendMessage(dispatchId: string, body: z.infer<typeof SendMessageSchema>) {
    return this.request(
      `/dispatches/${encodeURIComponent(dispatchId)}/messages`,
      MessageResponseSchema,
      { method: 'POST', body: JSON.stringify(SendMessageSchema.parse(body)) },
    );
  }
}

export function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function sandboxDocument(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${content}</body></html>`;
}
