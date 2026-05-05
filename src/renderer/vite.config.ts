import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Antontron's renderer ships in two shells: Electron (the desktop app)
// and Web (browser, served by anton-local-environment / Lightsail). Both
// build from the same `cowork/` tree but have different entry points
// (main.tsx vs web-main.tsx) and HTML scaffolds (index.html vs web.html).
//
// `npm run build:renderer`     → Electron build, outputs to dist/renderer/
// `npm run build:web`          → web build, outputs to dist/web/
//
// The web build sets BUILD_TARGET=web. In dev (`npm run dev`), only the
// Electron entry runs; the web build is a one-shot artifact for the
// reverse proxy to serve.
const TARGET = process.env.BUILD_TARGET === 'web' ? 'web' : 'electron';

const ENTRY_HTML = TARGET === 'web' ? 'web.html' : 'index.html';
const OUT_DIR = TARGET === 'web' ? '../../dist/web' : '../../dist/renderer';

// Vite emits the entry HTML at the source name (web.html → dist/web/web.html).
// nginx wants `index.html` for SPA fallback. Tried `generateBundle` to rename
// in-bundle, but Vite handles HTML emits outside the standard Rollup bundle
// map, so the rename has no effect there. Falling back to a `closeBundle`
// rename — runs once per build, including each iteration of `--watch`, so
// the output is always `index.html` regardless of mode.
const renameWebEntryHtmlPlugin = () => ({
  name: 'rename-web-entry-html',
  closeBundle() {
    if (TARGET !== 'web') return;
    const outDir = path.resolve(__dirname, OUT_DIR);
    const src = path.join(outDir, 'web.html');
    const dst = path.join(outDir, 'index.html');
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  },
});

export default defineConfig({
  plugins: [react(), renameWebEntryHtmlPlugin()],
  root: __dirname,
  base: './',
  build: {
    outDir: path.resolve(__dirname, OUT_DIR),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, ENTRY_HTML),
    },
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
