import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Two build targets share this config:
//   - electron (default): outputs to dist/renderer/, entry index.html → main.tsx,
//     packaged by electron-builder.
//   - web (BUILD_TARGET=web): outputs to dist/renderer-web/, entry index-web.html
//     → web-main.tsx, served by the FastAPI host when ANTON_SERVE_SPA=1.
//
// Default behavior is unchanged when BUILD_TARGET is unset, so existing
// `npm run build` and `npm run dev` paths are byte-identical to before.
const IS_WEB = process.env.BUILD_TARGET === 'web';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
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
      '/v1': 'http://127.0.0.1:26866',
      '/health': 'http://127.0.0.1:26866',
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
