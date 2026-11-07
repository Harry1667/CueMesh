# Validation — November 7, 2026

Local frontend evidence, not production or backend acceptance.

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

At the referenced main checkout only the API documents were present. Real registration/login, two-account invitation/message flows, real extension ingestion and provider calls have not been verified. Automated API tests use controlled responses.

Oracle deployment, TLS, Nginx syntax on the target VM, deployed CSP and production CORS remain unverified; no public domain was supplied. GitHub Actions is a template, not an observed CI run.

Development origin was delivered to Harry in [issue #1](https://github.com/Harry1667/CueMesh/issues/1). The backend integration checklist is in BACKEND_HANDOFF.md.
