import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Frame } from '@playwright/test';
import type { WebPreferences } from 'electron';

import { PREVIEW_FRAME_NAME } from '../src/shared/document-preview';
import { buildPreviewSrcdoc, PREVIEW_SANDBOX, previewFramePolicy } from '../src/renderer/cowork/preview/frameDocument';
import {
  launchPreviewHost,
  loadTokenFrames,
  mountFrame,
  requestingDocument,
  startTokenServer,
  type PreviewHost,
  type RecordedRequest,
  type TokenServer,
} from './helpers/document-preview-electron';

/*
 * The desktop document preview's isolation. The host window
 * (helpers/document-preview-electron-app.cjs) runs on the main window's
 * production webPreferences and preload (main-window-preferences.ts), with the
 * production guard (document-preview-guard.ts), and adds the server token to
 * loopback requests the way app.ts does. A loopback server records which
 * requests arrived with the token.
 *
 * The isolation checks build the real preview frame from frameDocument.ts's
 * exports. The real frame's policy blocks fetches and server images, so the
 * token checks also use a frame that carries the preview name and no content
 * policy, which exercises the main process's rule alone.
 */

/* The script the preview frame runs. Its policy allows it by its hash. */
const PREVIEW_SCRIPT = 'document.documentElement.dataset.previewScript = "ran";';

let server: TokenServer;
let host: PreviewHost;

test.beforeAll(async () => {
  server = await startTokenServer();
  host = await launchPreviewHost(server);
});

test.afterAll(async () => {
  await host?.close();
  await server?.close();
});

test.beforeEach(async () => {
  await host.page.evaluate(() => document.querySelectorAll('iframe').forEach((frame) => frame.remove()));
});

function mountPreviewFrame(): Promise<Frame> {
  const scriptSha256 = createHash('sha256').update(PREVIEW_SCRIPT).digest('base64');
  return mountFrame(host.page, {
    id: 'preview',
    name: PREVIEW_FRAME_NAME,
    sandbox: PREVIEW_SANDBOX,
    srcdoc: buildPreviewSrcdoc({
      policy: previewFramePolicy(scriptSha256),
      token: randomBytes(16).toString('hex'),
      scriptText: PREVIEW_SCRIPT,
      scriptSha256,
    }),
  });
}

/* The requests the server received under this path prefix, sorted by path. */
function requestsUnder(prefix: string): RecordedRequest[] {
  return server.requests.filter((request) => request.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path));
}

function pathsUnder(prefix: string): string[] {
  return requestsUnder(prefix).map((request) => request.path);
}

test.describe('the preview frame', () => {
  test('runs on the production webPreferences, with the preload flag on', async () => {
    const preferences = await host.app.evaluate(({ BrowserWindow }) => {
      /* Electron's runtime method; its typings leave it out. */
      const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): WebPreferences | null };
      const { sandbox, webSecurity, contextIsolation, nodeIntegration } = contents.getLastWebPreferences() ?? {};
      return { sandbox, webSecurity, contextIsolation, nodeIntegration };
    });
    expect(preferences).toEqual({ sandbox: false, webSecurity: false, contextIsolation: true, nodeIntegration: false });
    expect(await host.page.evaluate(() => window.antontron.supportsDocumentPreview)).toBe(true);
  });

  test("runs frameDocument.ts's document in a process apart from the main frame's", async () => {
    const frame = await mountPreviewFrame();
    expect(await frame.evaluate(() => document.documentElement.dataset.previewScript)).toBe('ran');

    const processes = await host.app.evaluate(({ BrowserWindow }, name) => {
      const { mainFrame } = BrowserWindow.getAllWindows()[0].webContents;
      const preview = mainFrame.framesInSubtree.find((candidate) => candidate.name === name);
      return { main: mainFrame.osProcessId, preview: preview?.osProcessId };
    }, PREVIEW_FRAME_NAME);
    expect(processes.preview).toBeGreaterThan(0);
    expect(processes.preview).not.toBe(processes.main);
  });

  test('leaves the parent responsive while the frame busy-loops', async () => {
    const frame = await mountPreviewFrame();
    const busyUntil = frame.evaluate(() => {
      const end = Date.now() + 3_000;
      while (Date.now() < end) { /* spin */ }
    }).then(() => Date.now());
    await new Promise((resolve) => setTimeout(resolve, 300));

    const asked = Date.now();
    await host.page.evaluate(() => document.title);
    const answered = Date.now();
    const busyEnded = await busyUntil;

    expect(answered - asked).toBeLessThan(500);
    expect(answered).toBeLessThan(busyEnded);
  });

  test('runs the frame in an OS-sandboxed process on macOS', async () => {
    test.skip(process.platform !== 'darwin', 'getAppMetrics() reports `sandboxed` on macOS, and Playwright starts Electron with --no-sandbox on Linux');
    await mountPreviewFrame();
    const sandboxed = await host.app.evaluate(({ app, BrowserWindow }, name) => {
      const preview = BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree.find((candidate) => candidate.name === name);
      return app.getAppMetrics().find((metric) => metric.pid === preview?.osProcessId)?.sandboxed;
    }, PREVIEW_FRAME_NAME);
    expect(sandboxed).toBe(true);
  });

  /* Each way out of the frame, run on a fresh preview frame against its own URL. */
  const escapes: [string, (frame: Frame, url: string) => Promise<void>][] = [
    ['a link click', async (frame, url) => {
      await frame.evaluate((href) => {
        const link = document.createElement('a');
        link.id = 'escape';
        link.href = href;
        link.textContent = 'escape';
        document.body.append(link);
      }, url);
      await frame.click('#escape');
    }],
    ['location.href to the loopback server', (frame, url) => frame.evaluate((href) => { location.href = href; }, url)],
    ['a meta refresh', (frame, url) => frame.evaluate((href) => {
      const refresh = document.createElement('meta');
      refresh.httpEquiv = 'refresh';
      refresh.content = `0;url=${href}`;
      document.head.append(refresh);
    }, url)],
    ['location.href after the frame renames itself', (frame, url) => frame.evaluate((href) => {
      window.name = 'renamed';
      location.href = href;
    }, url)],
  ];

  for (const [label, escape] of escapes) {
    test(`stays at about:srcdoc through ${label}, and opens nothing`, async () => {
      const frame = await mountPreviewFrame();
      const url = `${server.origin}/nav/${label.replace(/\W+/g, '-')}`;

      await escape(frame, url);
      await expect.poll(async () => (await host.record()).navigations.filter((navigation) => navigation.url === url))
        .toEqual([{ url, cancelled: true }]);

      expect(await frame.evaluate(() => location.href)).toBe('about:srcdoc');
      expect(pathsUnder(new URL(url).pathname)).toEqual([]);
      const record = await host.record();
      expect(record.openedExternally).toEqual([]);
      expect(record.windowsCreated).toBe(1);
    });
  }
});

test.describe('the server token', () => {
  for (const surface of loadTokenFrames()) {
    test(`${surface.token ? 'reaches' : 'never reaches'} the ${surface.id} frame's image and fetch`, async () => {
      const folder = `/f/${surface.id}/`;
      const folderUrl = `${server.origin}${folder}`;
      const framesBefore = (await host.record()).framesCreated.length;
      const frame = await mountFrame(host.page, {
        id: surface.id,
        name: surface.previewName ? PREVIEW_FRAME_NAME : undefined,
        sandbox: surface.sandbox,
        ...(surface.load === 'src'
          ? { src: `${folderUrl}index.html` }
          : { srcdoc: surface.base ? `<base href="${folderUrl}">${requestingDocument('')}` : requestingDocument(folderUrl) }),
      });

      await expect.poll(() => pathsUnder(folder)).toEqual(expect.arrayContaining([`${folder}data.txt`, `${folder}image.png`]));
      expect(requestsUnder(folder).filter((request) => request.authorized !== surface.token)).toEqual([]);
      /* The guard reads the same name at the same event, before the frame's first request. */
      const namesAtCreation = (await host.record()).framesCreated.slice(framesBefore);
      const expectedName = surface.previewName ? PREVIEW_FRAME_NAME : '';
      expect(namesAtCreation).toContain(expectedName);
      expect(namesAtCreation.filter((name) => name !== expectedName)).toEqual([]);
      const imageWidth = () => frame.evaluate(() => {
        const image = document.querySelector('img');
        return image?.complete ? image.naturalWidth : -1;
      });
      await expect.poll(imageWidth).toBe(surface.token ? 1 : 0);
    });
  }

  test('stays off the preview frame after it renames itself, and off a frame nested in it', async () => {
    const folder = '/f/preview-renamed/';
    const frame = await mountFrame(host.page, {
      id: 'preview-renamed',
      name: PREVIEW_FRAME_NAME,
      sandbox: 'allow-scripts',
      srcdoc: '<p>preview</p>',
    });
    await frame.evaluate((url) => {
      window.name = 'renamed';
      void fetch(`${url}renamed.txt`);
      new Image().src = `${url}image.png`;
      const nested = document.createElement('iframe');
      nested.srcdoc = `<script>fetch("${url}nested.txt")</script>`;
      document.body.append(nested);
    }, `${server.origin}${folder}`);

    await expect.poll(() => pathsUnder(folder)).toEqual([`${folder}image.png`, `${folder}nested.txt`, `${folder}renamed.txt`]);
    expect(requestsUnder(folder).filter((request) => request.authorized)).toEqual([]);
  });

  test('stays off a request with no frame', async () => {
    /* A main-process fetch goes through the session's webRequest listener with no frame. */
    const status = await host.app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, `${server.origin}/no-frame/data.txt`);
    expect(status).toBe(200);
    expect((await host.record()).listenerCalls).toContainEqual({ path: '/no-frame/data.txt', hadFrame: false });
    expect(requestsUnder('/no-frame/')).toEqual([{ path: '/no-frame/data.txt', authorized: false }]);
  });

  test("reaches the main window's fetch, image, redirect follow-up and download", async () => {
    const folder = '/main/';
    await host.page.evaluate(async (url) => {
      await fetch(`${url}data.txt`);
      await fetch(`${url}redirect`);
      await new Promise((resolve) => {
        const image = new Image();
        image.onload = image.onerror = resolve;
        image.src = `${url}image.png`;
      });
      const link = document.createElement('a');
      link.href = `${url}download`;
      link.download = 'download.bin';
      document.body.append(link);
      link.click();
      link.remove();
    }, `${server.origin}${folder}`);

    await expect.poll(() => pathsUnder(folder)).toEqual(['data.txt', 'download', 'image.png', 'redirect', 'redirected'].map((file) => `${folder}${file}`));
    expect(requestsUnder(folder).filter((request) => !request.authorized)).toEqual([]);
  });
});

test.describe('the navigation guard', () => {
  test('leaves the main window free to reload itself', async () => {
    await host.page.evaluate(() => { document.body.dataset.beforeReload = 'yes'; });
    await Promise.all([
      host.page.waitForEvent('load'),
      host.page.evaluate(() => { setTimeout(() => location.reload(), 0); }),
    ]);
    expect(await host.page.evaluate(() => document.body.dataset.beforeReload)).toBeUndefined();
    expect(await host.page.evaluate(() => window.antontron.supportsDocumentPreview)).toBe(true);
  });

  test('lets a srcdoc frame load new srcdoc content', async () => {
    const frame = await mountFrame(host.page, { id: 'editor', sandbox: 'allow-scripts', srcdoc: '<p id="version">one</p>' });
    await host.page.evaluate(() => new Promise<void>((resolve) => {
      const element = document.querySelector<HTMLIFrameElement>('#editor');
      element?.addEventListener('load', () => resolve(), { once: true });
      if (element) element.srcdoc = '<p id="version">two</p>';
    }));
    expect(await frame.locator('#version').textContent()).toBe('two');
  });

  test('lets an HTML viewer frame follow a link to the server', async () => {
    const folder = `${server.origin}/viewer/`;
    const frame = await mountFrame(host.page, {
      id: 'viewer',
      sandbox: 'allow-scripts allow-popups allow-forms allow-modals',
      src: `${folder}index.html`,
    });
    await frame.evaluate((href) => {
      const link = document.createElement('a');
      link.id = 'next';
      link.href = href;
      link.textContent = 'next';
      document.body.append(link);
    }, `${folder}next.txt`);
    await frame.click('#next');

    await expect.poll(() => frame.url()).toBe(`${folder}next.txt`);
    expect(requestsUnder('/viewer/next.txt')).toEqual([{ path: '/viewer/next.txt', authorized: true }]);
  });
});
