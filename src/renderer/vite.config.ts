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
