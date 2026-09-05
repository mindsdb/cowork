import { createLogger, defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { isSpaNavigation } from './web-spa-fallback';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Display version precedence: VITE_APP_VERSION, git describe, then package.json.
// CI needs full history for untagged commit distances; keep this aligned with
// gen-build-channel.mjs.
const explicitAppVersion = (process.env.VITE_APP_VERSION || '').trim();
let appVersion = explicitAppVersion.replace(/^v/, '') || pkg.version;
if (!explicitAppVersion) {
  try {
    appVersion = execSync('git describe --tags --match "v[0-9]*"', { cwd: __dirname, encoding: 'utf-8' }).trim().replace(/^v/, '');
  } catch {  }
}

// Embed the commit for diagnostics; tolerate builds without git.
let gitHash = '';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf-8' }).trim();
} catch {  }

// Default builds Electron into dist/renderer; BUILD_TARGET=web uses index-web.html and
// dist/renderer-web.
const IS_WEB = process.env.BUILD_TARGET === 'web';

const SERVER_PORT = Number(process.env.COWORK_SERVER_PORT || 26866);

// Electron starts the sidecar after Vite; startup ECONNREFUSED is expected.
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

// Rewrite HTML navigations through isSpaNavigation so deep routes load the web entry.
// See web-spa-fallback.ts for Accept-header and dotted-route handling.
const webSpaFallback = {
  name: 'cowork-web-spa-fallback',
  configureServer(server: any) {
    server.middlewares.use((req: any, _res: any, next: any) => {
      if (isSpaNavigation(req)) req.url = '/index-web.html';
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    // React Compiler skips components it cannot prove safe. plugin-react v6 removed babel support,
    // so run the compiler through @rolldown/plugin-babel.
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    ...(IS_WEB ? [webSpaFallback] : []),
  ],
  customLogger: logger,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_HASH__: JSON.stringify(gitHash),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  root: __dirname,
  envDir: path.resolve(__dirname, '../..'),
  // Electron file loads need relative assets; web deep routes need a root-absolute base.
  base: IS_WEB ? '/' : './',
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
