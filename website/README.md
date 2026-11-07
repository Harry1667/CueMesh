# CueMesh website

CueMesh's introduction and synced workspace, built with React, strict TypeScript and plain CSS. Accounts belong to `server/`; this app is its client.

## Run locally

Use Node 22.13+ (verified with Node 24) and pnpm 11.25.0.

```sh
cd website
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:4180. Vite proxies `/api` to `http://127.0.0.1:8000`. A missing backend produces an explicit live error.

| Route        | Purpose                                                      |
| ------------ | ------------------------------------------------------------ |
| `/`          | Introduction, native scrolling story, example model lineup   |
| `/workspace` | Projects, runs, agents, activity, artifacts                  |
| `/team`      | Shared projects, invitations, existing handoffs and messages |
| `/account`   | Server sign-in/registration and own devices                  |

The default is labeled demo data. Switching to live never substitutes sample results. Demo messages remain in memory.

## Preferences and design

The saved website language takes priority; otherwise the browser language list selects English, Traditional/Simplified Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Arabic or Hindi. Unsupported languages fall back to English. User-authored content is preserved. Arabic uses RTL layout. Selected translations load on demand.

Appearance supports light, dark and system. Only these preferences are saved to local storage. The palette is cobalt `#3659F5`, lilac `#B5A5EF`, midnight `#151C33`, off-white `#F6F5FA`. The workspace assumes familiarity: compact task/agent/result views, a keyboard-accessible run menu, and details in the inspector.

## Integration

Read [BACKEND_HANDOFF.md](docs/BACKEND_HANDOFF.md) alongside the authoritative root [cloud API](../docs/cloud-api.md) and [data contract](../docs/integration-contract.md). The website uses server v1 `/api` with an in-memory Bearer token; reload signs out. No separate account service, cookies, provider keys, or agent execution.

`public/runtime-config.json` is public deployment configuration, never a place for secrets. Default API path is `/api`; a configured HTTPS API URL must end in `/api`. Exact origins must be allowed by the backend and deployment CSP.

The seven-role demo model table follows the user's November 7 screenshot. It illustrates routing only; live model IDs come from the server.

## Checks and release

```sh
pnpm typecheck
pnpm test
pnpm contract:check
pnpm format:check
pnpm build
```

After intentional contract changes use `pnpm contract:generate`. Generated OpenAPI describes only the endpoints consumed here, not a replacement backend specification.

Deploy the contents of `dist/` using [Oracle/Nginx instructions](deploy/README.md). CI is provided as a template under `ci/`; it is not installed at repository root. See [VALIDATION.md](docs/VALIDATION.md) for actual evidence and untested boundaries.
