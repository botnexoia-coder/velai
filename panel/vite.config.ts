/// <reference types="vitest/config" />
// Panel admin v2 — servido por el propio worker como estáticos en admin.hirevai.com
// (mismo origen que la API: fetch relativo, sin CORS ni tokens propios — la cookie la
// pone Cloudflare Access y el worker valida el JWT).
// En desarrollo, el proxy apunta a `wrangler dev` (http://localhost:8787).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { version } from './package.json';

const WORKER_DEV = 'http://localhost:8787';

// ── Versión visible en el pie del panel ──────────────────────────────────────
// Dos piezas, porque cada una cubre lo que la otra no puede:
//  - la VERSIÓN SEMÁNTICA (package.json) la sube una persona y dice CUÁNTO cambió:
//      · PARCHE (2.0.x) — arreglo pequeño, nada nuevo que aprender
//      · MENOR  (2.x.0) — función o vista nueva, compatible con lo que había
//      · MAYOR  (x.0.0) — cambio grande o que rompe costumbres (v2 = el panel React)
//  - el COMMIT cambia SOLO en cada deploy: aunque se olvide subir la semántica, dos
//    despliegues nunca enseñan el mismo pie. Es lo que resuelve el «¿estoy viendo el
//    nuevo o el viejo?» sin depender de la disciplina de nadie.
function commitCorto(): string {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'dev'; }
}

export default defineConfig({
  define: {
    __PANEL_VERSION__: JSON.stringify(version),
    __PANEL_COMMIT__: JSON.stringify(commitCorto()),
    __PANEL_FECHA__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
