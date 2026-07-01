import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Bake the git commit hash into the bundle so it's available at runtime
// for diagnostics. Falls back gracefully outside a git repo.
let gitHash = '';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf-8' }).trim();
} catch { /* not a git repo or git not available */ }

// Two build targets share this config:
//   - electron (default): outputs to dist/renderer/, entry index.html → main.tsx,
//     packaged by electron-builder.
//   - web (BUILD_TARGET=web): outputs to dist/renderer-web/, entry index-web.html
//     → web-main.tsx, served by the FastAPI host when ANTON_SERVE_SPA=1.
//
// Default behavior is unchanged when BUILD_TARGET is unset, so existing
// `npm run build` and `npm run dev` paths are byte-identical to before.
const IS_WEB = process.env.BUILD_TARGET === 'web';

// In dev, vite's default html serving picks `index.html` for `/`, which
// is the Electron entry (depends on window.antontron and crashes in a
// regular browser). When BUILD_TARGET=web, rewrite bare `/` to the web
// entry so `http://localhost:5173/` is the canonical URL.
const webRootRewrite = {
  name: 'cowork-web-root-rewrite',
  configureServer(server: any) {
    server.middlewares.use((req: any, _res: any, next: any) => {
      if (req.url === '/' || req.url === '') {
        req.url = '/index-web.html';
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), ...(IS_WEB ? [webRootRewrite] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitHash),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  root: __dirname,
  envDir: path.resolve(__dirname, '../..'),
  base: './',
  build: {
    outDir: path.resolve(
      __dirname,
      IS_WEB ? '../../dist/renderer-web' : '../../dist/renderer',
    ),
    emptyOutDir: true,
    rollupOptions: IS_WEB
      ? { input: path.resolve(__dirname, 'index-web.html') }
      : undefined,
  },
  server: {
    port: Number(process.env.VITE_RENDERER_PORT || 5173),
    strictPort: true,
    proxy: {
      // Same override the main process honors (server-process.ts), so a
      // dev session can run against a sandboxed backend on another port.
      '/api': `http://127.0.0.1:${process.env.COWORK_SERVER_PORT || 26866}`,
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
