import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
  startBridge,
  stopBridge,
  getBridgeInfo,
  getBridgeEnv,
  writeBridgeDiscoveryFile,
  removeBridgeDiscoveryFile,
  BRIDGE_DISCOVERY_FILENAME,
} from './browser-bridge';
import type { BridgeActions, BridgeHandle } from './browser-bridge';
import { BrowserRequestError } from './browser-logic';

// Loopback-only integration: the global network deny stubs fetch/XHR, but
// node:http servers/clients on 127.0.0.1 work, so the bridge runs for real
// here with a fake manager facade.

function fakeActions(overrides: Partial<BridgeActions> = {}): BridgeActions {
  return {
    getState: () => ({ tabs: [], activeTabId: null, viewVisible: false }),
    newTab: vi.fn(async () => ({ tabId: 'tab-1' })),
    closeTab: vi.fn(async () => ({ ok: true })),
    activateTab: vi.fn(async () => ({ ok: true })),
    navigate: vi.fn(async (_tabId: string | undefined, url: string) => ({ tabId: 'tab-1', url })),
    goBack: vi.fn(async () => ({ ok: true })),
    goForward: vi.fn(async () => ({ ok: true })),
    reload: vi.fn(async () => ({ ok: true })),
    runScript: vi.fn(async () => ({ title: 'T', url: 'https://a.com', elements: [] })),
    clickAt: vi.fn(async () => ({ ok: true })),
    pressKey: vi.fn(async () => ({ ok: true })),
    insertText: vi.fn(async () => ({ ok: true })),
    pasteText: vi.fn(async () => ({ ok: true })),
    capturePng: vi.fn(async () => Buffer.from('png-bytes')),
    viewportInfo: vi.fn(async () => ({ cssWidth: 1280, cssHeight: 800, scale: 2 })),
    topSites: vi.fn(async () => [{ url: 'https://a.com', title: 'A', visits: 3, source: 'cowork' as const }]),
    markAgentControlled: vi.fn(),
    waitForLoadSettle: vi.fn(async () => {}),
    saveScreenshot: vi.fn(() => '/tmp/shot.png'),
    ...overrides,
  };
}

interface HttpResult {
  status: number;
  body: unknown;
}

function request(
  port: number,
  opts: { method?: string; path: string; token?: string; body?: unknown; rawBody?: string },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : null);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: opts.path,
        method: opts.method ?? (payload ? 'POST' : 'GET'),
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // non-JSON body — return raw text
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let handle: BridgeHandle | null = null;
let actions: BridgeActions;

beforeEach(async () => {
  actions = fakeActions();
  handle = await startBridge(actions);
});

afterEach(async () => {
  await stopBridge();
  handle = null;
});

describe('bridge auth + routing', () => {
  it('/health answers without auth', async () => {
    const res = await request(handle!.port, { path: '/health' });
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });

  it('every other route requires the bearer token', async () => {
    const noAuth = await request(handle!.port, { path: '/state' });
    expect(noAuth.status).toBe(401);
    const wrong = await request(handle!.port, { path: '/state', token: 'nope' });
    expect(wrong.status).toBe(401);
    const ok = await request(handle!.port, { path: '/state', token: handle!.token });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ tabs: [], activeTabId: null, viewVisible: false });
  });

  it('unknown routes 404 with an {error} body', async () => {
    const res = await request(handle!.port, { path: '/nope', token: handle!.token });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('unknown route') });
  });

  it('exposes port/token via getBridgeInfo + getBridgeEnv while running', () => {
    expect(getBridgeInfo()).toEqual({ port: handle!.port, token: handle!.token });
    expect(getBridgeEnv()).toEqual({
      COWORK_BROWSER_BRIDGE_PORT: String(handle!.port),
      COWORK_BROWSER_BRIDGE_TOKEN: handle!.token,
    });
    expect(handle!.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('startBridge is idempotent (same port/token)', async () => {
    const again = await startBridge(fakeActions());
    expect(again.port).toBe(handle!.port);
    expect(again.token).toBe(handle!.token);
  });

  it('concurrent starts share one server (no leaked bridge)', async () => {
    await stopBridge();
    const [a, b] = await Promise.all([startBridge(fakeActions()), startBridge(fakeActions())]);
    expect(a.port).toBe(b.port);
    expect(a.token).toBe(b.token);
    handle = a;
  });
});

describe('bridge tab + navigation endpoints', () => {
  it('POST /tabs creates+activates and marks the tab agent-controlled', async () => {
    const res = await request(handle!.port, {
      path: '/tabs', token: handle!.token, body: { url: 'https://a.com' },
    });
    expect(res).toEqual({ status: 200, body: { tabId: 'tab-1' } });
    expect(actions.newTab).toHaveBeenCalledWith({ url: 'https://a.com', activate: true });
    expect(actions.markAgentControlled).toHaveBeenCalledWith('tab-1');
  });

  it('POST /tabs honors activate:false (background tab), defaulting to true', async () => {
    const res = await request(handle!.port, {
      path: '/tabs', token: handle!.token, body: { url: 'https://a.com', activate: false },
    });
    expect(res.status).toBe(200);
    expect(actions.newTab).toHaveBeenCalledWith({ url: 'https://a.com', activate: false });
  });

  it('POST /tabs surfaces request errors (blocked url, tab cap) as 400', async () => {
    actions.newTab = vi.fn(async () => {
      throw new BrowserRequestError('tab limit reached (50)');
    });
    const res = await request(handle!.port, {
      path: '/tabs', token: handle!.token, body: { url: 'https://a.com' },
    });
    expect(res).toEqual({ status: 400, body: { error: 'tab limit reached (50)' } });
  });

  it('POST /navigate maps blocked urls to 400 without waiting for settle', async () => {
    actions.navigate = vi.fn(async () => {
      throw new BrowserRequestError('url not allowed: file:///etc/passwd');
    });
    const res = await request(handle!.port, {
      path: '/navigate', token: handle!.token, body: { url: 'file:///etc/passwd' },
    });
    expect(res).toEqual({ status: 400, body: { error: 'url not allowed: file:///etc/passwd' } });
    expect(actions.waitForLoadSettle).not.toHaveBeenCalled();
  });

  it('POST /navigate navigates, waits for load-settle, and returns {tabId, url}', async () => {
    const res = await request(handle!.port, {
      path: '/navigate', token: handle!.token, body: { url: 'https://b.com', tabId: 'tab-9' },
    });
    expect(res).toEqual({ status: 200, body: { tabId: 'tab-1', url: 'https://b.com' } });
    expect(actions.navigate).toHaveBeenCalledWith('tab-9', 'https://b.com', false);
    expect(actions.waitForLoadSettle).toHaveBeenCalledWith('tab-1');
    expect(actions.markAgentControlled).toHaveBeenCalledWith('tab-1');
  });

  it('POST /navigate without url is a 400', async () => {
    const res = await request(handle!.port, { path: '/navigate', token: handle!.token, body: {} });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'url required' });
  });

  it('POST /back|forward|reload resolve the default (active) tab', async () => {
    for (const route of ['/back', '/forward', '/reload']) {
      const res = await request(handle!.port, { path: route, token: handle!.token, body: {} });
      expect(res).toEqual({ status: 200, body: { ok: true } });
    }
    expect(actions.goBack).toHaveBeenCalledWith(undefined);
    expect(actions.goForward).toHaveBeenCalledWith(undefined);
    expect(actions.reload).toHaveBeenCalledWith(undefined);
  });

  it('POST /back passes the moved flag through (additive field)', async () => {
    actions.goBack = vi.fn(async () => ({ ok: true, moved: false }));
    const res = await request(handle!.port, { path: '/back', token: handle!.token, body: {} });
    expect(res).toEqual({ status: 200, body: { ok: true, moved: false } });
  });

  it('POST /tabs/close marks agent-controlled BEFORE closing the tab', async () => {
    const order: string[] = [];
    actions.markAgentControlled = vi.fn(() => {
      order.push('mark');
    });
    actions.closeTab = vi.fn(async () => {
      order.push('close');
      return { ok: true };
    });
    const res = await request(handle!.port, {
      path: '/tabs/close', token: handle!.token, body: { tabId: 'tab-7' },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(order).toEqual(['mark', 'close']);
    expect(actions.markAgentControlled).toHaveBeenCalledWith('tab-7');
  });

  it('POST /tabs/activate requires tabId; /tabs/close defaults to active', async () => {
    const missing = await request(handle!.port, {
      path: '/tabs/activate', token: handle!.token, body: {},
    });
    expect(missing.status).toBe(400);

    const ok = await request(handle!.port, {
      path: '/tabs/activate', token: handle!.token, body: { tabId: 'tab-3' },
    });
    expect(ok.status).toBe(200);
    expect(actions.activateTab).toHaveBeenCalledWith('tab-3');

    const closed = await request(handle!.port, {
      path: '/tabs/close', token: handle!.token, body: {},
    });
    expect(closed).toEqual({ status: 200, body: { ok: true } });
    expect(actions.closeTab).toHaveBeenCalledWith(undefined);
  });
});

describe('bridge DOM endpoints', () => {
  it('GET /read and /snapshot run scripts and pass the result through', async () => {
    const read = await request(handle!.port, {
      path: '/read?tabId=tab-1&maxChars=500', token: handle!.token,
    });
    expect(read.status).toBe(200);
    expect(actions.runScript).toHaveBeenCalledWith('tab-1', expect.stringContaining('const MAX = 500;'));

    const snap = await request(handle!.port, { path: '/snapshot', token: handle!.token });
    expect(snap.status).toBe(200);
    expect(snap.body).toEqual({ title: 'T', url: 'https://a.com', elements: [] });
  });

  it('POST /click runs the click script and waits for settle', async () => {
    actions.runScript = vi.fn(async () => true);
    const res = await request(handle!.port, {
      path: '/click', token: handle!.token, body: { index: 4 },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.runScript).toHaveBeenCalledWith(undefined, expect.stringContaining('els[4]'));
    expect(actions.waitForLoadSettle).toHaveBeenCalled();
    expect(actions.markAgentControlled).toHaveBeenCalled();
  });

  it('POST /click 404s when the element index is gone (stale snapshot)', async () => {
    actions.runScript = vi.fn(async () => false);
    const res = await request(handle!.port, {
      path: '/click', token: handle!.token, body: { index: 99 },
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('99') });
  });

  it('POST /click 409s on a snapshot-version mismatch, 404s without one', async () => {
    actions.runScript = vi.fn(async () => 'stale');
    const stale = await request(handle!.port, {
      path: '/click', token: handle!.token, body: { index: 2, v: 3 },
    });
    expect(stale).toEqual({ status: 409, body: { error: 'stale snapshot' } });
    // The version is threaded into the page-side script when provided.
    expect(actions.runScript).toHaveBeenCalledWith(undefined, expect.stringContaining('const expected = 3;'));

    actions.runScript = vi.fn(async () => 'stale');
    const typed = await request(handle!.port, {
      path: '/type', token: handle!.token, body: { index: 2, text: 'x', v: 9 },
    });
    expect(typed.status).toBe(409);
    expect(actions.runScript).toHaveBeenCalledWith(undefined, expect.stringContaining('const expected = 9;'));
  });

  it('POST /click without index is a 400', async () => {
    const res = await request(handle!.port, { path: '/click', token: handle!.token, body: {} });
    expect(res.status).toBe(400);
  });

  it('POST /type requires index, passes text/submit through', async () => {
    actions.runScript = vi.fn(async () => true);
    const res = await request(handle!.port, {
      path: '/type', token: handle!.token, body: { index: 1, text: 'hello', submit: true },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.runScript).toHaveBeenCalledWith(
      undefined,
      expect.stringContaining(JSON.stringify('hello')),
    );
    expect(actions.runScript).toHaveBeenCalledWith(undefined, expect.stringContaining('if (true)'));

    const missing = await request(handle!.port, {
      path: '/type', token: handle!.token, body: { text: 'x' },
    });
    expect(missing.status).toBe(400);
  });

  it('POST /scroll validates direction and runs the scroll script', async () => {
    const res = await request(handle!.port, {
      path: '/scroll', token: handle!.token, body: { direction: 'bottom' },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.runScript).toHaveBeenCalledWith(undefined, expect.stringContaining('"bottom"'));

    const missing = await request(handle!.port, { path: '/scroll', token: handle!.token, body: {} });
    expect(missing.status).toBe(400);
  });

  it('POST /screenshot captures and returns a tmp path plus viewport scale', async () => {
    const res = await request(handle!.port, { path: '/screenshot', token: handle!.token, body: {} });
    expect(res).toEqual({
      status: 200,
      body: { path: '/tmp/shot.png', cssWidth: 1280, cssHeight: 800, scale: 2 },
    });
    expect(actions.capturePng).toHaveBeenCalledWith(undefined);
    expect(actions.saveScreenshot).toHaveBeenCalledWith(Buffer.from('png-bytes'));
  });

  it('POST /click-at passes coordinates through and settles', async () => {
    const res = await request(handle!.port, {
      path: '/click-at', token: handle!.token, body: { tabId: 'tab-1', x: 120, y: 340 },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.clickAt).toHaveBeenCalledWith('tab-1', 120, 340);
    expect(actions.markAgentControlled).toHaveBeenCalledWith('tab-1');
    expect(actions.waitForLoadSettle).toHaveBeenCalledWith('tab-1');

    const missing = await request(handle!.port, { path: '/click-at', token: handle!.token, body: { x: 1 } });
    expect(missing.status).toBe(400);
  });

  it('POST /press passes key + modifiers through', async () => {
    const res = await request(handle!.port, {
      path: '/press', token: handle!.token, body: { key: 'enter', modifiers: ['cmd', 'shift'] },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.pressKey).toHaveBeenCalledWith(undefined, 'enter', ['cmd', 'shift']);

    const missing = await request(handle!.port, { path: '/press', token: handle!.token, body: {} });
    expect(missing.status).toBe(400);
  });

  it('POST /press filters non-string modifiers', async () => {
    await request(handle!.port, {
      path: '/press', token: handle!.token, body: { key: 'a', modifiers: ['cmd', 42, null] },
    });
    expect(actions.pressKey).toHaveBeenCalledWith(undefined, 'a', ['cmd']);
  });

  it('POST /insert-text passes text without a settle wait', async () => {
    const res = await request(handle!.port, {
      path: '/insert-text', token: handle!.token, body: { tabId: 'tab-2', text: 'hello' },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.insertText).toHaveBeenCalledWith('tab-2', 'hello');
    expect(actions.waitForLoadSettle).not.toHaveBeenCalled();

    const missing = await request(handle!.port, { path: '/insert-text', token: handle!.token, body: {} });
    expect(missing.status).toBe(400);
  });

  it('POST /paste passes the text through and settles', async () => {
    const res = await request(handle!.port, {
      path: '/paste', token: handle!.token, body: { tabId: 'tab-1', text: 'a\tb\n1\t2' },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(actions.pasteText).toHaveBeenCalledWith('tab-1', 'a\tb\n1\t2');
    expect(actions.waitForLoadSettle).toHaveBeenCalledWith('tab-1');

    const missing = await request(handle!.port, { path: '/paste', token: handle!.token, body: {} });
    expect(missing.status).toBe(400);
  });

  it('GET /top-sites passes the limit through', async () => {
    const res = await request(handle!.port, { path: '/top-sites?limit=5', token: handle!.token });
    expect(res.status).toBe(200);
    expect(actions.topSites).toHaveBeenCalledWith(5);
    expect(res.body).toEqual([{ url: 'https://a.com', title: 'A', visits: 3, source: 'cowork' }]);
  });

  it('malformed JSON bodies are a 400, not a crash', async () => {
    const res = await request(handle!.port, {
      path: '/navigate', token: handle!.token, rawBody: '{oops',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid JSON body' });
  });

  it('oversized bodies get a 413 response on a live socket', async () => {
    const res = await request(handle!.port, {
      path: '/navigate', token: handle!.token, rawBody: `{"url":"${'x'.repeat(1024 * 1024)}` ,
    });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: 'body too large' });
  });

  it('action failures surface as 500 {error}', async () => {
    actions.navigate = vi.fn(async () => {
      throw new Error('no active tab');
    });
    const res = await request(handle!.port, {
      path: '/navigate', token: handle!.token, body: { url: 'https://x.com' },
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'no active tab' });
  });
});

describe('bridge discovery file', () => {
  it('writes {port, token, pid} atomically with 0600 perms', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-discovery-'));
    try {
      writeBridgeDiscoveryFile(dir, 12345, 'tok');
      const file = path.join(dir, BRIDGE_DISCOVERY_FILENAME);
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
        port: 12345, token: 'tok', pid: process.pid,
      });
      const mode = fs.statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removeBridgeDiscoveryFile deletes the file and tolerates its absence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-discovery-'));
    try {
      writeBridgeDiscoveryFile(dir, 12345, 'tok');
      const file = path.join(dir, BRIDGE_DISCOVERY_FILENAME);
      expect(fs.existsSync(file)).toBe(true);
      removeBridgeDiscoveryFile(dir);
      expect(fs.existsSync(file)).toBe(false);
      // Second removal is a no-op, not a throw.
      expect(() => removeBridgeDiscoveryFile(dir)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getBridgeEnv is empty once stopped', async () => {
    await stopBridge();
    expect(getBridgeInfo()).toBeNull();
    expect(getBridgeEnv()).toEqual({});
  });
});
