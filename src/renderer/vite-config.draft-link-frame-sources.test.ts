import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

import { DRAFT_LINK_ORIGINS, withDraftLinkFrameSources } from '../shared/draft-link-origins';

// Loads the real renderer config as a dev server for each kind of build and
// checks which of them put the draft hosts in the web page's CSP.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_KEYS = ['BUILD_TARGET', 'VITE_PLATFORM_UI'] as const;
type BuildEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const PLUGIN = 'cowork-draft-link-frame-sources';
const page = (name: string) => readFileSync(path.resolve(__dirname, name), 'utf-8');

function cspOf(html: string): string {
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (!meta) throw new Error('no CSP meta tag');
  return meta[1];
}

let server: ViteDevServer | undefined;

async function startServer(env: BuildEnv): Promise<ViteDevServer> {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  server = await createServer({
    configFile: path.resolve(__dirname, 'vite.config.ts'),
    logLevel: 'silent',
    // Background work the test does not need: the dependency optimizer, and the
    // page script warmup that compiles the whole app graph and slows a loaded run.
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, ws: false, preTransformRequests: false },
  });
  return server;
}

const pluginNames = (dev: ViteDevServer) => dev.config.plugins.map((plugin) => plugin.name);

afterEach(async () => {
  await server?.close();
  server = undefined;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('draft hosts in the web page CSP', () => {
  it('go into the web entry of a web build with the platform UI on', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'true' });
    expect(pluginNames(dev)).toContain(PLUGIN);

    const html = await dev.transformIndexHtml('/index-web.html', page('index-web.html'));
    expect(cspOf(html)).toBe(cspOf(withDraftLinkFrameSources(page('index-web.html'))));
  }, 30_000);

  it('stay out of other pages the web dev server serves', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'true' });

    const html = await dev.transformIndexHtml('/index.html', page('index.html'));
    expect(cspOf(html)).toBe(cspOf(page('index.html')));
  }, 30_000);

  it('stay out of a web build with the platform UI off', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'false' });
    expect(pluginNames(dev)).not.toContain(PLUGIN);

    const html = await dev.transformIndexHtml('/index-web.html', page('index-web.html'));
    expect(cspOf(html)).toBe(cspOf(page('index-web.html')));
    for (const origin of DRAFT_LINK_ORIGINS) expect(html).not.toContain(origin);
  }, 30_000);

  it('stay out of the desktop build', async () => {
    const dev = await startServer({});
    expect(pluginNames(dev)).not.toContain(PLUGIN);

    const html = await dev.transformIndexHtml('/index.html', page('index.html'));
    expect(cspOf(html)).toBe(cspOf(page('index.html')));
  }, 30_000);
});
