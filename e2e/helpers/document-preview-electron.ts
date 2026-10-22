/*
 * Helpers for e2e/document-preview-electron.spec.ts: a loopback server that
 * records whether each request carried the token, the isolated Electron host
 * (document-preview-electron-app.cjs), and frame mounting in its window.
 */
import { _electron as electron, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

/* A 1x1 PNG. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/* One request the loopback server received: its path and whether it carried the token. */
export interface RecordedRequest { path: string; authorized: boolean }

export interface TokenServer {
  port: number;
  /* The server's origin, http://127.0.0.1:<port>. */
  origin: string;
  token: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/* A document that requests image.png and fetches data.txt, with each URL put after `prefix`. */
export function requestingDocument(prefix: string): string {
  return `<img src="${prefix}image.png"><script>fetch("${prefix}data.txt")</script>`;
}

/*
 * Serves every path on 127.0.0.1 and records each request. image.png answers
 * only a request that carries the token, the way the server answers with auth
 * on. index.html is requestingDocument with relative URLs, redirect answers 307
 * to `redirected` beside it, and download answers as an attachment.
 */
export async function startTokenServer(): Promise<TokenServer> {
  const token = randomBytes(16).toString('hex');
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authorized = req.headers.authorization === `Bearer ${token}`;
    requests.push({ path: url.pathname, authorized });
    const file = path.posix.basename(url.pathname);
    if (file === 'image.png') {
      res.writeHead(authorized ? 200 : 401, { 'content-type': 'image/png' }).end(authorized ? PIXEL_PNG : undefined);
    } else if (file === 'index.html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(requestingDocument(''));
    } else if (file === 'redirect') {
      res.writeHead(307, { location: 'redirected' }).end();
    } else if (file === 'download') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="download.bin"' }).end('x');
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    token,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* One subframe will-frame-navigate, and whether the guard cancelled it. */
export interface NavigationRecord { url: string; cancelled: boolean }

/* One request the token listener saw, and whether Electron named a frame for it. */
export interface ListenerCall { path: string; hadFrame: boolean }

/* What the host's main process records (globalThis.previewHost in the .cjs host). */
export interface HostRecord {
  navigations: NavigationRecord[];
  openedExternally: string[];
  windowsCreated: number;
  /* The name each frame had when frame-created fired, or null when it couldn't be read. */
  framesCreated: (string | null)[];
  listenerCalls: ListenerCall[];
}

export interface PreviewHost {
  app: ElectronApplication;
  page: Page;
  record(): Promise<HostRecord>;
  close(): Promise<void>;
}

export async function launchPreviewHost(server: TokenServer): Promise<PreviewHost> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-preview-guard-'));
  /* ELECTRON_RUN_AS_NODE makes the binary plain Node, which rejects Playwright's flags. */
  const { ELECTRON_RUN_AS_NODE: _dropped, ...env } = process.env;
  const app = await electron.launch({
    args: [path.resolve('e2e/helpers/document-preview-electron-app.cjs')],
    env: {
      ...(env as Record<string, string>),
      PREVIEW_HOST_PROFILE: profile,
      PREVIEW_HOST_SERVER_PORT: String(server.port),
      PREVIEW_HOST_TOKEN: server.token,
    },
  });
  const page = await app.firstWindow();
  await page.waitForURL(/document-preview-electron\.html$/);
  return {
    app,
    page,
    record: () => app.evaluate(() => (globalThis as unknown as { previewHost: HostRecord }).previewHost),
    close: async () => {
      await app.close();
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

export interface FrameInit {
  id: string;
  name?: string;
  sandbox: string;
  src?: string;
  srcdoc?: string;
}

/* Appends an iframe to the host page, waits for its first load, and returns its Playwright frame. */
export async function mountFrame(page: Page, init: FrameInit): Promise<Frame> {
  await page.evaluate((frameInit) => new Promise<void>((resolve) => {
    const frame = document.createElement('iframe');
    frame.id = frameInit.id;
    if (frameInit.name) frame.name = frameInit.name;
    frame.setAttribute('sandbox', frameInit.sandbox);
    if (frameInit.src) frame.src = frameInit.src;
    if (frameInit.srcdoc) frame.srcdoc = frameInit.srcdoc;
    frame.addEventListener('load', () => resolve(), { once: true });
    document.body.append(frame);
  }), init);
  const frame = await page.locator(`#${init.id}`).elementHandle().then((element) => element?.contentFrame());
  if (!frame) throw new Error(`frame ${init.id} did not attach`);
  return frame;
}

/* A frame the token checks mount, as e2e/helpers/document-preview-electron.yaml describes it. */
export interface TokenFrame {
  id: string;
  previewName?: boolean;
  sandbox: string;
  load: 'src' | 'srcdoc';
  base?: boolean;
  token: boolean;
}

function isTokenFrame(value: unknown): value is TokenFrame {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string'
    && typeof entry.sandbox === 'string'
    && (entry.load === 'src' || entry.load === 'srcdoc')
    && typeof entry.token === 'boolean'
    && (entry.previewName === undefined || typeof entry.previewName === 'boolean')
    && (entry.base === undefined || typeof entry.base === 'boolean');
}

/* Reads tokenFrames from the YAML file. Throws when the list is missing or
   empty, or when an entry is not a TokenFrame, so a bad file fails the spec
   instead of leaving it with no token checks. */
export function loadTokenFrames(): TokenFrame[] {
  const file = path.resolve('e2e/helpers/document-preview-electron.yaml');
  const parsed: unknown = yaml.load(fs.readFileSync(file, 'utf8'));
  const frames: unknown = typeof parsed === 'object' && parsed !== null && 'tokenFrames' in parsed ? parsed.tokenFrames : undefined;
  if (!Array.isArray(frames) || frames.length === 0 || !frames.every(isTokenFrame)) {
    throw new Error(`${file} needs a non-empty tokenFrames list whose entries match TokenFrame`);
  }
  return frames;
}
