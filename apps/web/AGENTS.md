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
- Honest display (brief 11): medium confidence is "unsicher" in a neutral colour, no percentage outside the details view, every card carries the disclaimer, no per-person scores. `src/lib/format.ts` is the only place that maps verdicts to labels, icons and colours.
- Server messages are validated with `@lfc/contracts` (`WsServerMessage`, `ApiError`, …) before they touch state; invalid messages are dropped.
- The gateway token lives only in `localStorage` (`src/state/settings.ts`, ADR 0011) and is sent only in the `Authorization` header or the WebSocket `auth` message, never in a URL.
- Live mode (phase 2, ADR 0015): consent is asked before every recording and names every active cloud provider from `/api/status`; without that list there is no recording (fails closed). `src/state/recording.ts` sends frames only between `audio.started` and the stop and releases the microphone on every end (stop, server stop, lost connection, screen lock or app switch); every end reason has a German text. The microphone is the system boundary (`src/audio/microphone.ts`, interface `Microphone`); `src/audio/pcm.ts` is the only place that turns samples into PCM16 frames.
- Stage 2b and 4 replace `getUserMedia` with a synthetic tone on `MediaDevices.prototype` (WebKit ignores assigning it on the instance); stage 2b never imports built workspace packages (their `dist` does not exist in the CI job), so contract values are inlined there with a pointer.
- Stage 2b uses `tests/mock-backend.ts` (routeWebSocket + route) with contract-shaped events; keep it in sync when contracts change. Extend it and the page objects in `tests/pages/` before writing new helpers; one page object per page or component.
- Test pyramid for the frontend: stores, hooks, formatting and single components in stage 1 (Vitest); flows across components against the mocked backend in 2b; only the journeys of brief 13.2 in stage 4 (`tests/e2e`).
