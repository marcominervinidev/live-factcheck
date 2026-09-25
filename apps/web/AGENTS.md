# AGENTS.md – apps/web

Rules for the frontend only. Repo-wide rules: `/AGENTS.md`.

- Mobile-first PWA (brief 11): the iPhone viewport is the first target; respect safe-area insets.
- All UI texts come from `src/i18n/de.json` via `t()`; never inline German strings in components.
- No environment values in the bundle: runtime settings come from `/config.json` (validated with zod in `src/app/runtime-config.ts`); it never contains secrets. The browser never sees an API key; everything goes through the gateway.
- State lives in Zustand stores; components stay thin.
- Stable `data-testid` on every element a test or page object needs.
- Accessibility: colour is never the only signal; every status has icon and text.
- Tests: unit tests next to the code (`*.test.ts(x)`, jsdom, Testing Library). The backend is the system boundary: stub `fetch`/WebSocket, never internal modules.
- Dockerfile: `dev` runs Vite with HMR; `runtime` is nginx-unprivileged (uid 101) with a read-only root filesystem and `/tmp` as tmpfs. `docker/40-runtime-config.sh` writes `/tmp/config.json` from `WEB_GATEWAY_URL` and refuses unsafe values.
