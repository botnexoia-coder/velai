/// <reference types="vitest/config" />
// Panel admin v2 — servido por el propio worker como estáticos en admin.hirevai.com
// (mismo origen que la API: fetch relativo, sin CORS ni tokens propios — la cookie la
// pone Cloudflare Access y el worker valida el JWT).
// En desarrollo, el proxy apunta a `wrangler dev` (http://localhost:8787).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const WORKER_DEV = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Toda la API del panel y los medios (logos) viven en el worker.
      '/api': WORKER_DEV,
      '/media': WORKER_DEV,
      '/favicon.svg': WORKER_DEV,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
