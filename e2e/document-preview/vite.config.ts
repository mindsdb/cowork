/*
 * The document preview harness page, served on 127.0.0.1:5210 for
 * playwright.document-preview.config.ts.
 *
 * Before the server starts it regenerates the app's preview bundles, so the
 * page loads the same renderer bundles a build would. It also serves:
 *   - /fixtures/<set>/<file>, each fixture file's bytes as they are, with no
 *     HTML transform;
 *   - virtual:navigation-preview-bundle, the frame runtime built with the
 *     test-only navigation renderer through the generator's own checks;
 *   - /upload.html, the file viewer page, where stubs/ stand in for the
 *     app's API, its authenticated fetch and its Markdown renderer.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { buildPreviewBundle, generatePreviewBundles } from '../../scripts/preview-bundles.mjs';
import navigationRenderer from './navigation-renderer';

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const NAVIGATION_BUNDLE_ID = 'virtual:navigation-preview-bundle';
const RESOLVED_NAVIGATION_BUNDLE_ID = `\0${NAVIGATION_BUNDLE_ID}`;
/* A fixture set or file name: no separators and no leading dot. */
const FIXTURE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fixtureFiles(): Plugin {
  return {
    name: 'document-preview-fixtures',
    configureServer(server) {
      server.middlewares.use('/fixtures/', (req, res, next) => {
        const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
        if (parts.length !== 2 || !parts.every((part) => FIXTURE_NAME.test(part))) {
          next();
          return;
        }
        readFile(path.join(FIXTURES_DIR, ...parts)).then((bytes) => {
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(bytes);
        }, () => next());
      });
    },
  };
}

function navigationBundle(): Plugin {
  return {
    name: 'document-preview-navigation-bundle',
    resolveId: (id) => (id === NAVIGATION_BUNDLE_ID ? RESOLVED_NAVIGATION_BUNDLE_ID : null),
    async load(id) {
      if (id !== RESOLVED_NAVIGATION_BUNDLE_ID) return null;
      const bundle = await buildPreviewBundle({
        type: navigationRenderer.type,
        renderPath: path.join(__dirname, 'navigation-renderer.ts'),
      });
      const exported = { type: navigationRenderer.type, scriptText: bundle.text, scriptSha256: bundle.sha256 };
      return `export default ${JSON.stringify(exported)};`;
    },
  };
}

/* Resolves each app module the file viewer page can't run here to its stub:
   the harness has no API server, no sign-in and no chat renderer. */
function fileViewerStubs(): Plugin {
  const renderer = path.join(REPO_ROOT, 'src/renderer/cowork');
  const stubs = new Map([
    [path.join(renderer, 'api.js'), path.join(__dirname, 'stubs/api.ts')],
    [path.join(renderer, 'lib/authenticatedResource.js'), path.join(__dirname, 'stubs/authenticatedResource.ts')],
    [path.join(renderer, 'components/markdown/MarkdownContent.jsx'), path.join(__dirname, 'stubs/MarkdownContent.ts')],
  ]);
  return {
    name: 'document-preview-file-viewer-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (resolved && stubs.get(resolved.id)) ?? null;
    },
  };
}

export default defineConfig(async () => {
  await generatePreviewBundles();
  return {
    root: __dirname,
    plugins: [react(), fixtureFiles(), navigationBundle(), fileViewerStubs()],
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    server: { host: '127.0.0.1', port: 5210, strictPort: true, fs: { allow: [REPO_ROOT] } },
  };
});
