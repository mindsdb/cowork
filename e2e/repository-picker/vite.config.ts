import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, '../../src/renderer/public'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5206, strictPort: true, fs: { allow: [path.resolve(__dirname, '../..')] } },
  resolve: { alias: { '@shared': path.resolve(__dirname, '../../src/shared') } },
});
