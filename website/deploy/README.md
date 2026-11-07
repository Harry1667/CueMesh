# Oracle Cloud VM + Nginx

The release is static `dist/` content; Node is not required to serve it. Nginx serves the four SPA routes and proxies `/api/*` to Harry's server. No VM deployment has been performed and no public domain/IP was supplied.

## Build

From `website/`:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm contract:check
pnpm format:check
pnpm build
```

Configure `dist/runtime-config.json` for the target environment:

```json
{
  "dataMode": "live",
  "apiBaseUrl": "/api",
  "pollIntervalMs": 3000,
  "extensionInstallUrl": "https://github.com/Harry1667/CueMesh#readme"
}
```

Keep demo mode until a working server is available. This public JSON must never contain secrets. The default extension link is repository documentation, not a verified store listing.

## Install the release

1. Upload only `dist/` contents into a new release directory under `/srv/cuemesh/releases/`.
2. Point `/srv/cuemesh/current` at that release; keep the previous release for rollback. Retain hashed assets needed by open tabs.
3. Replace the domain, certificate paths and upstream port in `nginx.conf.example`. Provision DNS, valid TLS and the intended Oracle/OS HTTPS ingress.
4. Run server v1 bound to loopback under its own service manager. Add the exact public website origin to `WEBSITE_ORIGINS`; the development origin is http://127.0.0.1:4180.
5. Apply OS-appropriate read permissions and SELinux labels. Run `sudo nginx -t`, then reload Nginx only after it passes.

The example preserves the full /api path, disables proxy buffering/cache, and allows 75 seconds between upstream reads to accommodate SSE keepalives. Its provisional 10 MiB request ceiling must agree with backend limits. The website itself polls; it does not open SSE.

HTML and runtime configuration revalidate; hashed assets cache for one year. Missing assets and API routes never fall through to the SPA. API responses must use no-store on the server. The app uses Bearer authorization, not cookies. A cross-origin HTTPS API additionally needs matching CORS and the Nginx CSP connect-src updated to the exact API origin.

## Verify on the actual VM

Open and refresh /, /workspace, /team and /account directly. Confirm runtime mode, real server login/logout, authorization failures and a real synced extension run. GET /api/me without a token should return a JSON 401, not HTML.

Check that artifact previews obey the deployed CSP, backend downtime remains a live error, credentials are absent from web storage, and private API responses are not cached. Do not infer any of these production results from local unit tests.

Rollback restores both the previous static release and its matching runtime config. See ../docs/BACKEND_HANDOFF.md and ../docs/VALIDATION.md.
