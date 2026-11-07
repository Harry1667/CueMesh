# Frontend handoff — server v1

## 給 Harry / 後端 Codex

網站只負責畫面，帳號統一呼叫 `server/`。依據 main `c03029375b14160bd9b39b65cd97e772d7416124` 的根目錄 `docs/cloud-api.md` 與 `docs/integration-contract.md`。本文件取代舊的 /api/web/v1、cookie、CSRF、配對 token 與 Supabase 提案；那些不是目前的實作。

開發 origin 是 **http://127.0.0.1:4180**，已通知在 [GitHub issue #1](https://github.com/Harry1667/CueMesh/issues/1)。請把精確 origin 加入 `WEBSITE_ORIGINS`；不要加路徑。這是 Ethan 電腦的 loopback，不能當作 Harry 可遠端開啟的網址。Oracle 公開 origin 與測試 API URL 尚未提供。

Frontend branch: `web/cuemesh-experience`. Changes stay inside `website/`. Harry owns server, extension execution, data storage, authorization and hosting infrastructure.

## Transport and authentication

- Default `/api`; Vite/Nginx forwards the full path to loopback port 8000.
- JSON, `Accept-Language`, `Authorization: Bearer <token>`, `credentials: omit`, no-store, 12-second client timeout.
- Token exists only in AuthProvider memory. Reload signs out. A 401 clears auth; logout clears locally even if server revocation fails, and reports that failure.
- No cookie/CSRF flow, OAuth endpoints, Supabase, local accounts or provider-key input.
- Timestamps are Unix milliseconds. IDs stay opaque strings and are URL encoded. Validate payloads with Zod before use.
- Runtime config accepts `/api` or an HTTPS URL ending in `/api`; HTTP is limited to loopback. No query, hash or embedded credentials.

## Consumed endpoints

| Method/path (under /api)                  | Request / response                                                   |
| ----------------------------------------- | -------------------------------------------------------------------- |
| POST /auth/register                       | {email,password,displayName} → 201 {token,user}; password minimum 10 |
| POST /auth/login                          | {email,password} → {token,user}                                      |
| POST /auth/logout                         | No body → 204                                                        |
| GET /me                                   | {user}                                                               |
| GET /devices                              | {devices}; account view filters mine                                 |
| GET /projects                             | {projects}, including owner/member role                              |
| PUT /projects/:id                         | {name,description} → {project}; client UUID                          |
| POST /projects/:id/invites                | {} → 201 {code,expiresAt}; owner only                                |
| POST /invites/accept                      | {code} → {project}                                                   |
| GET /projects/:id/members                 | {members}                                                            |
| GET /projects/:id/runs                    | {runs}; summaries                                                    |
| GET /runs/:id                             | {run}; embeds tasks/events/artifacts                                 |
| GET /dispatches?role=incoming or outgoing | {dispatches}; merge and deduplicate                                  |
| GET /dispatches/:id                       | {dispatch,messages}                                                  |
| POST /dispatches/:id/messages             | {id,kind,text,replyTo} → 201 {message}                               |

Message kind is question, answer or progress; text is limited to 20 KB UTF-8. A retry retains its message UUID. A successful POST means the service saved a message, not that work finished. Responses from a prior selected handoff/project cannot replace the current one.

Errors follow `{error:{code,message}}`. Server messages are shown as supplied. HTTP 401/403 removes protected snapshots; transient errors retain the last received snapshot with an error and manual reconnect. No fabricated fallback success.

## Synchronization and data ownership

`api.ts` owns network requests. `contracts.ts` validates responses; `useWorkspace.ts` and `useTeamWorkspace.ts` manage lifecycle and cancellation.

Run polling occurs only while planning/running, using the configured 3-second default after each completed response. Team lists poll at least 5 seconds apart. Polling stops on a transport error until refresh. This client does not consume SSE or register itself as an execution device. The Nginx example supports the backend's 25-second SSE keepalive for other clients.

The run adapter splits embedded tasks/events/artifacts into the UI's detail shape, validates run/project identity, rejects duplicate task/artifact IDs and conflicting event data, sorts/deduplicates events, and preserves all 17 event types from the contract. Source links allow HTTP(S) only.

The website creates/joins projects and invites members, and replies to existing handoffs. It does not create/approve/reject/cancel dispatch execution, edit device permissions, control browsers, or manage the encrypted key vault. Those remain with the extension/server.

## Artifact display

HTML is sanitized by DOMPurify and rendered in a sandboxed iframe with no sandbox permissions and a restrictive CSP: no scripts, forms, network or external resources. This is a static preview; interactive code cannot run there. Source/download keeps the original reported content. Plain text and Markdown remain text; no raw server HTML enters the parent DOM.

## Demo model configuration

The user's latest supplied table takes precedence for the website demo:

| Role     | Primary         | Ordered fallbacks                |
| -------- | --------------- | -------------------------------- |
| research | gpt-6.1-sol     | claude-sonnet-5-5                |
| coding   | claude-opus-5-5 | claude-sonnet-5-5, gpt-6.1-sol   |
| 3d       | claude-opus-5-5 | gpt-6.1-sol                      |
| vision   | gpt-6.1-terra   | claude-opus-5-5                  |
| planning | claude-opus-5-5 | gpt-6.1-sol                      |
| review   | gpt-6.1-sol     | claude-opus-5-5                  |
| browser  | claude-opus-5-5 | claude-sonnet-5-5, gpt-6.1-terra |

Source: `src/data/modelRouting.ts`. This is example presentation, not an API-availability assertion or execution routing. It differs from the Gemini recommendations in root `docs/model-comparison.md`; that shared file was deliberately not changed. Confirm actual extension routing separately. Live cards always display the received task.model; unknown IDs remain unchanged.

## Integration acceptance

1. Start server v1 at port 8000 and add the exact dev origin. Launch the website at port 4180.
2. Verify real registration/login/logout, rate limits, invalid credentials and token expiry. Reload must sign out.
3. Sync an actual extension run; confirm project/run IDs, all task states, activity, cost estimates and artifact content.
4. Create/join a shared project, issue a one-use invite and verify membership permission changes.
5. Confirm incoming/outgoing handoffs, context, messages and duplicate UUID retry behavior across two real accounts.
6. Check permission revocation while polling, failed API responses and reconnect without sample substitutions.
7. Set the public domain, TLS and WEBSITE_ORIGINS; verify all four direct SPA routes through Nginx and the deployed artifact CSP.

Generated `contracts/openapi.json` and ten fixture files describe frontend consumption, not proof of server compatibility. See `VALIDATION.md` for observed checks. At the referenced checkout the server implementation was not present; real account, cloud and extension acceptance remains pending.
