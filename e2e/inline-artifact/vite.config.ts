import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Test-only: the live inline artifact card and the viewer it opens, wired as
// ChatView wires them, for playwright.inline-artifact.config.ts. The spec
// stands in for the server (page.route).
export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, '../../src/renderer/public'),
  plugins: [react()],
  define: { __PLATFORM_UI__: 'true', __WEB_BUILD__: 'true', __APP_VERSION__: '"0.0.0"', __GIT_HASH__: '"test"', __BUILD_TIME__: '"0"' },
  server: { host: '127.0.0.1', port: 5212, strictPort: true, fs: { allow: [path.resolve(__dirname, '../..')] } },
  resolve: { alias: { '@shared': path.resolve(__dirname, '../../src/shared') } },
});
