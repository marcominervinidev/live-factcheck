import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Dev server only: serves /config.json from WEB_GATEWAY_URL, like the nginx entrypoint does in
 * production. Nothing is written into the bundle.
 */
function devRuntimeConfig(): Plugin {
  return {
    name: 'lfc-dev-runtime-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/config.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ gatewayUrl: process.env['WEB_GATEWAY_URL'] ?? '/api' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devRuntimeConfig()],
  // Workspace packages (@lfc/contracts) resolve to their TypeScript sources.
  resolve: { conditions: ['development', ...defaultClientConditions] },
  server: {
    // Reached through Caddy as https://localhost or the LAN name (brief 12).
    allowedHosts: ['localhost', '.local'],
  },
  build: {
    sourcemap: true,
    // Fonts stay files: Caddy's CSP allows `font-src 'self'` only, so an inlined data: URI is
    // blocked (found by stage 4; vite preview in stage 2b has no CSP). Other assets as default.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
});
