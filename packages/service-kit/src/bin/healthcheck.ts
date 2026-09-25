// Container healthcheck without curl (runtime images have no shell tools):
//   node node_modules/@lfc/service-kit/dist/bin/healthcheck.js
// Exits 0 when GET /healthz on 127.0.0.1:$PORT answers 200 within 2 s, else 1.
const port = process.env['PORT'] ?? '';

try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(2_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
