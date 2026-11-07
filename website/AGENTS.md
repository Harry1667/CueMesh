# Website work instructions

Read the root README, `docs/BACKEND_HANDOFF.md`, and the repository's `../docs/integration-contract.md` before changing integration behavior.

- Own `website/` only. The backend teammate and extension owner keep their implementation ownership. Use `web/…` branches; open a PR instead of pushing to `main`.
- The repository's `../docs/cloud-api.md` v1 and `../docs/integration-contract.md` are authoritative. Accounts are owned by `server/`. Do not introduce a second account service, Supabase, invented OAuth routes, or cookie/CSRF transport. Discuss shared-contract changes before editing shared files.
- The website displays synced work. Do not introduce direct agent execution, browser control, approvals, provider key collection, or fabricated successful results.
- Keep `demo` and `live` explicit. Live failures stay failures. Demo content is authored sample data, never evidence that agents ran.
- Keep fetches in `src/lib/api.ts`, validate responses in `src/lib/contracts.ts`, and handle data lifecycle in `useWorkspace.ts`. Use React state only for interaction and asynchronous resource state; derive filtered lists and counters during rendering.
- Use strict TypeScript, named components, semantic HTML, plain CSS and shared tokens. Use Prettier with this directory's configuration. Comments should explain constraints or non-obvious choices.
- Motion must preserve native wheel, touch, keyboard, anchor, and browser navigation. Maintain reduced-motion support. Avoid timers or animation libraries for decorative motion.
- Treat synced strings and HTML as untrusted. Render ordinary text through React. Preserve DOMPurify, the empty iframe sandbox, restrictive preview CSP, and URL checks. Never put raw artifact HTML into the parent document.
- Keep credentials out of repository files and web storage. The server v1 Bearer token lives only in the AuthProvider's memory. Reload signs out; a 401 clears the token and protected data. Use `credentials: omit`.
- Default API requests to same-origin `/api`. An operator may configure the agreed HTTPS server origin; coordinate `WEBSITE_ORIGINS` and the Nginx CSP. Never route user data through a new service.
- Run `pnpm typecheck`, `pnpm test`, `pnpm contract:check`, `pnpm format:check`, and `pnpm build`. For UI changes, verify the changed flow in a browser at desktop and narrow widths. Report the evidence and its limits.
- Regenerate OpenAPI/fixtures with `pnpm contract:generate` after intentional schema changes, and review the diff. Do not hand-edit generated JSON.
- Update the handoff and validation record when behavior changes. Never claim the backend, cloud release, extension integration, or production security was tested solely because frontend unit tests passed.
