import { createLogger, defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// App display version resolution (baked into __APP_VERSION__ at build time):
//
//   1. VITE_APP_VERSION env var — set by CI for prod builds. prod-build-deploy.yml
//      creates a CalVer tag (e.g. v2.26.7.1.1) and passes it to build-installers.yml
//      as app_version, which lands here via the build step's env.
//      Result: clean version like "2.26.7.1.1".
//
//   2. git describe --tags — used by staging and dev builds (no explicit
//      version passed). Requires fetch-depth: 0 in CI so tags are available.
//      On a tagged commit: clean version. On an untagged commit (typical for
//      staging): includes distance and short SHA, e.g. "2.26.6.30.1-3-g1a2b3c4".
//
//   3. package.json — last resort when git tags aren't available (e.g. Docker
//      builds or repos without tags). Currently "2.0.7" (stale, not maintained).
const explicitAppVersion = (process.env.VITE_APP_VERSION || '').trim();
let appVersion = explicitAppVersion.replace(/^v/, '') || pkg.version;
if (!explicitAppVersion) {
  try {
    appVersion = execSync('git describe --tags --match "v[0-9]*"', { cwd: __dirname, encoding: 'utf-8' }).trim().replace(/^v/, '');
  } catch { /* no tags or not a git repo — falls back to package.json */ }
}

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
    // plugin-react v6 (oxc) dropped the `babel` option; the compiler now
    // rides @rolldown/plugin-babel with the exported preset.
    react(),
    babel({ presets: [reactCompilerPreset()] }),
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
