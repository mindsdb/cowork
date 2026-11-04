// The editor a doc's owner gets on its shared page: one self-contained script
// (React included) and one stylesheet, copied beside doc.html and published
// with it. `npm run build:doc-editor` -> dist/doc-editor/doc-editor.{js,css}.
// The desktop app hands the folder to cowork-server as COWORK_DOC_EDITOR_DIR.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  // Only the script and stylesheet: the app's public assets stay with the app.
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __PLATFORM_UI__: 'false',
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist/doc-editor'),
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, 'doc-web/entry.js'),
      formats: ['iife'],
      name: 'CoworkDocEditor',
      fileName: () => 'doc-editor.js',
      cssFileName: 'doc-editor',
    },
  },
});
