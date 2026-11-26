#!/usr/bin/env node
/*
 * Builds the shared document viewer (ENG-4687): one classic script per type at
 * dist/renderer-web/document-viewer/v1/<type>.js, which a shared .docx, .pptx
 * or .xlsx page loads from the Cowork web app (cowork-server's file_page.py
 * writes that page). Each script is src/renderer/cowork/preview/share/entry.ts
 * with that type's generated renderer bundle, the one the app's preview runs,
 * so a shared file renders as it does in the app.
 *
 * `v1` is the page contract (the mount element and the <html> state
 * attribute in mountDocumentViewer.tsx), not the build: pages already shared
 * load the newest viewer, so a change that breaks that contract takes a new
 * folder. A PDF page uses the browser's own viewer, so it has no script.
 *
 * Runs after build:web, once preview-bundles.mjs has written the generated
 * bundles. Classic scripts, not modules: a module from another origin needs
 * CORS headers, a classic script doesn't.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { build } from 'vite';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_DIR = path.join(REPO_ROOT, 'src/renderer/cowork/preview');
const ENTRY = path.join(PREVIEW_DIR, 'share/entry.ts');
export const VIEWER_TYPES = Object.freeze(['docx', 'pptx', 'xlsx']);
export const VIEWER_DIR = 'document-viewer/v1';
const BUNDLE_ID = 'virtual:document-viewer-bundle';
const RESOLVED_BUNDLE_ID = `\0${BUNDLE_ID}`;

/* The type's generated renderer bundle, as the module the entry imports. */
function viewerBundle(type) {
  return {
    name: 'document-viewer-bundle',
    resolveId(id) {
      return id === BUNDLE_ID ? RESOLVED_BUNDLE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_BUNDLE_ID) return null;
      const generated = path.join(PREVIEW_DIR, 'generated');
      const scriptText = readFileSync(path.join(generated, `${type}.iife.txt`), 'utf8');
      const hashes = JSON.parse(readFileSync(path.join(generated, 'preview-hashes.gen.json'), 'utf8'));
      if (!hashes[type]) throw new Error(`document viewer ${type}: no generated bundle hash; run scripts/preview-bundles.mjs first`);
      return `export default ${JSON.stringify({ type, scriptText, scriptSha256: hashes[type], assets: null })};`;
    },
  };
}

export async function buildDocumentViewer(type, outDir) {
  await build({
    configFile: false,
    root: REPO_ROOT,
    logLevel: 'warn',
    plugins: [react(), viewerBundle(type)],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: true,
      reportCompressedSize: false,
      lib: {
        entry: ENTRY,
        formats: ['iife'],
        name: 'coworkDocumentViewer',
        fileName: () => `${type}.js`,
      },
    },
  });
}

export async function buildDocumentViewers(outDir = path.join(REPO_ROOT, 'dist/renderer-web', VIEWER_DIR)) {
  for (const type of VIEWER_TYPES) await buildDocumentViewer(type, outDir);
  return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = await buildDocumentViewers();
  console.log(`document viewer: ${VIEWER_TYPES.join(', ')} → ${path.relative(REPO_ROOT, outDir)}`);
}
