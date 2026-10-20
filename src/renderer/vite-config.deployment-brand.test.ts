import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

// Loads the real renderer config as a web dev server with the platform UI off,
// the setup in which the deployment brand plugin runs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_KEYS = ['BUILD_TARGET', 'VITE_PLATFORM_UI'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const page = (name: string) => readFileSync(path.resolve(__dirname, name), 'utf-8');

let server: ViteDevServer;

beforeAll(async () => {
  process.env.BUILD_TARGET = 'web';
  process.env.VITE_PLATFORM_UI = 'false';
  server = await createServer({
    configFile: path.resolve(__dirname, 'vite.config.ts'),
    logLevel: 'silent',
    // The dependency optimizer would start in the background and race close().
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, ws: false },
  });
}, 30_000);

afterAll(async () => {
  await server?.close();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('web dev server with the deployment brand', () => {
  it('serves a page other than the web entry without the brand', async () => {
    const html = await server.transformIndexHtml('/index.html', page('index.html'));
    expect(html).not.toContain('cowork-deployment-brand');
  });

  it('brands the web entry', async () => {
    const html = await server.transformIndexHtml('/index-web.html', page('index-web.html'));
    expect(html).toContain('<!-- cowork-deployment-brand:start -->');
    expect(html).toContain('<!-- cowork-deployment-brand:end -->');
  });
});
