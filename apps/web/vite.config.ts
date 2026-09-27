import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
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
  server: {
    // Reached through Caddy as https://localhost or the LAN name (brief 12).
    allowedHosts: ['localhost', '.local'],
  },
  build: {
    sourcemap: true,
  },
});
