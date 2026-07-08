import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Resolve the app version from the latest git tag (CalVer), falling back
// to package.json when tags aren't available (e.g. Docker builds stamp
// package.json before building).
let appVersion = pkg.version;
try {
  appVersion = execSync('git describe --tags --abbrev=0', { cwd: __dirname, encoding: 'utf-8' }).trim().replace(/^v/, '');
} catch { /* no tags or not a git repo — use package.json */ }

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

const SERVER_PORT = Number(process.env.COWORK_SERVER_PORT || 26866);

// `npm run dev` boots vite before Electron spawns the sidecar, so downgrade the expected startup ECONNREFUSED proxy noise to a calm line.
const logger = createLogger();
const logError = logger.error;
logger.error = (msg, options) => {
  const err = options?.error as NodeJS.ErrnoException | undefined;
  if (err?.code === 'ECONNREFUSED' && msg.includes('http proxy error')) {
    logger.info(`/api proxy: cowork-server not listening on :${SERVER_PORT} yet`, { timestamp: true });
    return;
  }
  logError(msg, options);
};

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
  plugins: [
    // React Compiler (React 19) — auto-memoizes components and handlers at
    // build time, cutting cascade re-renders (e.g. one Sidebar state change
    // re-rendered 68 components before, 12 after). Components it can't
    // prove safe are skipped, so it degrades gracefully.
    react({ babel: { plugins: ['babel-plugin-react-compiler'] } }),
    ...(IS_WEB ? [webRootRewrite] : []),
  ],
  customLogger: logger,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
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
      '/api': `http://127.0.0.1:${SERVER_PORT}`,
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});