import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

import { withDeploymentBrand } from '../shared/deployment-brand';
import { withDraftLinkFrameSources } from '../shared/draft-link-origins';
import { withOrgBrandImageSources } from '../shared/org-brand-image-origins';
import { withGalleryImageSources } from '../shared/gallery-image-origins';

// Loads the real renderer config as a dev server for each kind of build and
// checks which of them put the deployment brand's tags in the web page.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_KEYS = ['BUILD_TARGET', 'VITE_PLATFORM_UI', 'VITE_BRAND_ENV'] as const;
type BuildEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const PLUGIN = 'cowork-deployment-brand';
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

describe('the deployment brand in the web page', () => {
  it('goes into the web entry of a web build with the platform UI off', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'false' });

    const html = await dev.transformIndexHtml('/index-web.html', page('index-web.html'));
    expect(html).toContain('<!-- cowork-deployment-brand:start -->');
    expect(html).toContain('<!-- cowork-deployment-brand:end -->');
  }, 30_000);

  it('goes into the web entry of the hosted build, beside the draft hosts', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'true' });
    expect(pluginNames(dev)).toContain(PLUGIN);

    const html = await dev.transformIndexHtml('/index-web.html', page('index-web.html'));
    expect(html).toContain('<!-- cowork-deployment-brand:start -->');
    expect(html).toContain('<script src="/brand/brand.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/brand/brand.css" />');
    expect(cspOf(html)).toBe(cspOf(withGalleryImageSources(withOrgBrandImageSources(withDraftLinkFrameSources(withDeploymentBrand(page('index-web.html')))))));
  }, 30_000);

  it("names only the build's own environment's console for gallery pictures", async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'true', VITE_BRAND_ENV: 'staging' });
    const html = await dev.transformIndexHtml('/index-web.html', page('index-web.html'));
    const imgSrc = cspOf(html).split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === 'img-src') ?? [];
    expect(imgSrc).toContain('https://console.staging.mindshub.ai');
    expect(imgSrc).not.toContain('https://console.mindshub.ai');
  }, 30_000);

  it('names the dev wildcard once in a development page, for brand and gallery pictures alike', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'true', VITE_BRAND_ENV: 'development' });
    const html = await dev.transformIndexHtml('/index-web.html', page('index-web.html'));
    const imgSrc = cspOf(html).split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === 'img-src') ?? [];
    expect(imgSrc.filter((source) => source === 'https://*.dev.mindshub.ai')).toHaveLength(1);
  }, 30_000);

  it('stays out of other pages the web dev server serves', async () => {
    const dev = await startServer({ BUILD_TARGET: 'web', VITE_PLATFORM_UI: 'true' });

    const html = await dev.transformIndexHtml('/index.html', page('index.html'));
    expect(html).not.toContain('cowork-deployment-brand');
  }, 30_000);

  it('stays out of the desktop build', async () => {
    const dev = await startServer({});
    expect(pluginNames(dev)).not.toContain(PLUGIN);
    expect(dev.config.define?.__WEB_BUILD__).toBe('false');

    const html = await dev.transformIndexHtml('/index.html', page('index.html'));
    expect(html).not.toContain('cowork-deployment-brand');
    expect(html).not.toContain('/brand/');
  }, 30_000);
});
