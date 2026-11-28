import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  // Its own dependency cache: npm run test:fixtures starts every fixture's server
  // at once, and servers sharing node_modules/.vite delete each other's files.
  cacheDir: path.resolve(__dirname, '../../node_modules/.vite', path.basename(__dirname)),
  // host.ts reads the build target (src/renderer/lib/buildTarget.ts).
  define: { __WEB_BUILD__: 'false' },
  publicDir: path.resolve(__dirname, '../../src/renderer/public'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5361, strictPort: true, fs: { allow: [path.resolve(__dirname, '../..')] } },
  resolve: { alias: { '@shared': path.resolve(__dirname, '../../src/shared') } },
});
