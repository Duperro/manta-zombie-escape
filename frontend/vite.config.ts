import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = Object.fromEntries(['health', 'mapa', 'estado'].map(path => [`/api/${path}`, {
    target: env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true,
    rewrite: (url: string) => url.replace(/^\/api/, ''),
  }]));
  const controlKey = env.API_KEY || process.env.API_KEY;
  const controlGuard: Plugin = { name: 'local-simulation-controls', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/control')) return next();
      const host = req.headers.host;
      const origin = req.headers.origin;
      const allowedHost = host === '127.0.0.1:5173' || host === 'localhost:5173';
      const allowedOrigin = !origin || origin === `http://${host}`;
      const mutation = req.method !== 'GET';
      if (!allowedHost || !allowedOrigin || (mutation && (!origin || !req.headers['content-type']?.startsWith('application/json')))) {
        res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: 'Origen de control no permitido' })); return;
      }
      if (!controlKey) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: 'Inicia Vite con la misma API_KEY del backend local' })); return; }
      next();
    });
  } };
  const controlProxy: Record<string, ProxyOptions> = controlKey ? { '/api/control': { target: env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true,
    rewrite: (url: string) => url.replace(/^\/api/, ''), headers: { 'x-api-key': controlKey } } } : {};
  return { plugins: [react(), controlGuard], server: { port: 5173, strictPort: true, proxy: { ...proxy, ...controlProxy } },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], globals: true,
      include: ['src/**/*.test.{ts,tsx}'], pool: 'forks', maxWorkers: 1 },
    build: { sourcemap: false },
  };
});
