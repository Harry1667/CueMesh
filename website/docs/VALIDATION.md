# Validation — November 7, 2026

Frontend checks plus a bounded public-site and extension-source audit. This is not full production or cross-device acceptance.

## Automated checks

- TypeScript strict check: passed.
- Vitest: 29 tests passed across contracts/API behavior and locale/model configuration.
- Generated OpenAPI and ten fixtures match source.
- Production Vite build: passed; page and translation chunks are split.
- Rollup reported two annotation-position warnings in Zod dependency comments; build succeeded.
- Formatting checked using website/.prettierignore (dependency caches and generated files excluded).

Coverage includes mixed resource IDs, malformed responses, event ordering, timestamps, server v1 envelopes, Bearer/no-cookie transport, authentication failures, message retry identity and byte limits, runtime API URL rules, preview restrictions, browser-language resolution and complete keys/placeholders for all 11 catalogs.

## Browser observations

Checked in the Codex in-app Chromium browser:

- Introduction and workspace in light/dark themes; 320px, 390px, 768px and 1280px viewport layouts across this implementation pass.
- Native-scroll chapters and reduced-motion CSS fallback. No scroll hijacking.
- English, Traditional Chinese, German and Arabic UI; Arabic RTL and preserved original user content.
- A 320px overflow caused by the body's minimum width was found and fixed. Document scroll width equals client width after the fix.
- New run menu renders in the current theme; keyboard arrows/Home/Enter switch runs, Escape closes, and focus returns to the trigger.
- Completed/partial/empty project states; task inspector selection, activity/artifact tabs and isolated HTML preview.
- Team mobile view has no document horizontal overflow. Adding a demo message changes only in-memory demo state and explicitly reports that nothing was sent.
- Earlier checks covered preferences, setup-dialog Escape/focus return and unavailable-live error behavior.

No physical iPhone, Android or iPad, Safari/WebKit session, screen-reader audit or native-speaker translation review was performed. Viewport emulation does not establish behavior on every device.

## Integration boundaries

The initial frontend checkout contained API documents without the server implementation. The recording audit subsequently inspected `ext/mvp` at `361d413f1fe18dd5463db7aeab419c41e0f3637b`, which includes server and cross-device code. Fetched main `bda3a7043921026e0135a645cd5f8b42efc1ce6c` does not yet contain that cloud implementation.

Real registration/login, two-account invitation/message flows, real extension ingestion and provider calls have not been verified. Automated API tests use controlled responses. The user reports that the two recording devices are not yet linked.

## Recording audit

- Re-ran strict type checking, all 29 frontend tests, generated-contract consistency, formatting and the production build. All passed.
- Fixed Vite's API target: the earlier local port 8000 was unavailable. Development and production preview now proxy to the extension's deployed default, `https://cuemesh.looptw.com`, with `CUEMESH_API_TARGET` as a local-server override.
- Matched the registration display-name limit to the actual server: 80 characters in both the input and request schema. Regenerated OpenAPI.
- Public HTTPS root returned 200. `/workspace` rendered the live sign-in screen with no captured console errors. The deployed commit and full authenticated flows were not established.
- Public `GET /api/me` without authorization returned the expected JSON 401. A preflight for `http://127.0.0.1:4180`, GET and the authorization header returned 204 with that exact allowed origin. Local Vite `/api/me` returned the same real JSON 401 after the proxy fix.
- The built local preview rendered the compact workspace with no captured console errors.
- In an isolated copy of `ext/mvp`, `node --test --test-concurrency=1 --test-reporter=spec 'test/browser/*.test.js' 'test/core/*.test.js' 'test/cloud/*.test.js' 'test/ui/*.test.js'` passed **236 tests in 20 suites**. These cover simulated council/routing, browser approvals/protected fields, remote consent, question/report behavior and UI logic. Providers, browser actions and network flows are controlled test doubles.
- Provider-SDK tests and the extension build were not run: dependency preparation stopped with a pnpm resolution-policy error. The PostgreSQL server suite was not run; no production database was reset or populated for testing.
- Source review shows that rejecting a browser action returns a denial to the model; it does not necessarily cancel the whole run. The recording narration has been corrected accordingly.

Actual VM configuration, Nginx syntax, deployed artifact CSP, physical devices, real model calls and the complete A → B → A flow remain unverified. GitHub Actions is a template, not an observed CI run. Follow [DEMO-RECORDING.md](DEMO-RECORDING.md) before recording the collaboration scene.

Development origin was delivered to Harry in [issue #1](https://github.com/Harry1667/CueMesh/issues/1). The backend integration checklist is in BACKEND_HANDOFF.md.
