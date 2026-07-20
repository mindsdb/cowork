// Loopback HTTP bridge between the Python agent's browser tools and the
// embedded browser. Plain node:http, no deps, bound to
// 127.0.0.1 on a random port; every request except /health needs
// `Authorization: Bearer <token>` (32 random bytes, per main launch).
//
// This module is deliberately electron-free: the manager injects a
// BridgeActions facade, which keeps the bridge unit-testable with plain fake
// actions and lets server-process.ts import discovery helpers without
// dragging electron into its module graph.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { BrowserState, TopSite } from '../../shared/browser-types';
import { BrowserRequestError } from './browser-logic';
import { DEFAULT_STASH, domClickScript, domReadScript, domScrollScript, domSnapshotScript, domTypeScript } from './browser-dom-tools';

// Everything the bridge needs from the manager. tabId resolution
// (default = active tab) happens inside the manager for every method.
export interface BridgeActions {
  getState(): BrowserState;
  newTab(opts: { url?: string; activate?: boolean }): Promise<{ tabId: string }>;
  closeTab(tabId?: string): Promise<{ ok: boolean }>;
  activateTab(tabId: string): Promise<{ ok: boolean }>;
  navigate(tabId: string | undefined, url: string, newTab?: boolean): Promise<{ tabId: string; url: string }>;
  goBack(tabId?: string): Promise<{ ok: boolean; moved?: boolean }>;
  goForward(tabId?: string): Promise<{ ok: boolean; moved?: boolean }>;
  reload(tabId?: string): Promise<{ ok: boolean }>;
  runScript(tabId: string | undefined, script: string): Promise<unknown>;
  /** Trusted CDP input for canvas-rendered apps (Sheets, Figma…). */
  clickAt(tabId: string | undefined, x: number, y: number): Promise<{ ok: boolean }>;
  pressKey(tabId: string | undefined, key: string, modifiers?: string[]): Promise<{ ok: boolean }>;
  insertText(tabId: string | undefined, text: string): Promise<{ ok: boolean }>;
  pasteText(tabId: string | undefined, text: string): Promise<{ ok: boolean }>;
  capturePng(tabId?: string): Promise<Buffer>;
  /** CSS viewport size + devicePixelRatio — for mapping screenshot pixels to
   *  click-at CSS coordinates. */
  viewportInfo(tabId?: string): Promise<{ cssWidth: number; cssHeight: number; scale: number }>;
  topSites(limit?: number): Promise<TopSite[]>;
  listApps(): import('./browser-logic').BrowserApp[];
  openApp(appId: string): Promise<{ tabId: string; created: boolean } | { error: string }>;
  /** Flags the tab agent-controlled for ~10 s (drives TabInfo.isAgentControlled). */
  markAgentControlled(tabId?: string): void;
  /** Resolves once the tab's load settles (did-stop-loading or timeout). */
  waitForLoadSettle(tabId?: string): Promise<void>;
  /** Saves a PNG buffer to a tmp file and returns its path. */
  saveScreenshot(png: Buffer): string;
}

export interface BridgeHandle {
  port: number;
  token: string;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Discovery (env for the spawned server + file for anything else)
// ---------------------------------------------------------------------------

let running: { server: http.Server; port: number; token: string } | null = null;

/** window[...] key for the snapshot→click/type element stash. The manager
 *  injects a per-launch randomized name (page JS can't fake what it can't
 *  guess); defaults to the well-known name for direct unit tests. */
let elementStash = DEFAULT_STASH;

/** Constant-time bearer-token check (lengths must match for timingSafeEqual). */
function tokenOk(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header, 'utf-8');
  const b = Buffer.from(`Bearer ${token}`, 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function getBridgeInfo(): { port: number; token: string } | null {
  return running ? { port: running.port, token: running.token } : null;
}

/** Env vars for the cowork-server subprocess. Best-effort discovery — the
 *  browser-bridge.json file in coworkHome() is the authoritative path. */
export function getBridgeEnv(): Record<string, string> {
  if (!running) return {};
  return {
    COWORK_BROWSER_BRIDGE_PORT: String(running.port),
    COWORK_BROWSER_BRIDGE_TOKEN: running.token,
  };
}

export const BRIDGE_DISCOVERY_FILENAME = 'browser-bridge.json';

/** Write the discovery file {port, token, pid} with 0600 perms (atomic). */
export function writeBridgeDiscoveryFile(dir: string, port: number, token: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, BRIDGE_DISCOVERY_FILENAME);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ port, token, pid: process.pid }), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

/** Remove the discovery file (clean shutdown) — a stale file would send the
 *  Python side to a dead port with an old token. Best-effort. */
export function removeBridgeDiscoveryFile(dir: string): void {
  try {
    fs.unlinkSync(path.join(dir, BRIDGE_DISCOVERY_FILENAME));
  } catch {
    // never written or already gone
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        // Keep draining (and discard) so the 413 response goes out on a live
        // socket — destroying the request here would kill the connection
        // before the response is written.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'body too large'));
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, 'JSON object body expected'));
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'invalid JSON body'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'request failed')));
  });
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

async function route(
  req: http.IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
  actions: BridgeActions,
): Promise<unknown> {
  const method = req.method ?? 'GET';
  const p = url.pathname;
  const q = (name: string) => str(url.searchParams.get(name)) ?? undefined;
  const tabId = str(body.tabId) ?? q('tabId');

  if (method === 'GET' && p === '/state') {
    // apps ride along so the agent can label tabs by app in ONE call.
    return { ...actions.getState(), apps: actions.listApps() };
  }

  if (method === 'POST' && p === '/tabs') {
    // activate defaults to true (current behavior); the agent can pass
    // activate:false to open a background tab.
    const { tabId: id } = await actions.newTab({ url: str(body.url), activate: body.activate !== false });
    actions.markAgentControlled(id);
    return { tabId: id };
  }

  if (method === 'POST' && p === '/tabs/close') {
    // Mark BEFORE closing — after the close the id resolves to the NEXT
    // active tab and flags the wrong one.
    actions.markAgentControlled(tabId);
    return actions.closeTab(tabId);
  }

  if (method === 'POST' && p === '/tabs/activate') {
    if (!tabId) throw new HttpError(400, 'tabId required');
    const result = await actions.activateTab(tabId);
    actions.markAgentControlled(tabId);
    return result;
  }

  if (method === 'POST' && p === '/navigate') {
    const target = str(body.url);
    if (!target) throw new HttpError(400, 'url required');
    const result = await actions.navigate(tabId, target, body.newTab === true);
    actions.markAgentControlled(result.tabId);
    await actions.waitForLoadSettle(result.tabId);
    return result;
  }

  if (method === 'POST' && p === '/back') {
    const result = await actions.goBack(tabId);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return result;
  }

  if (method === 'POST' && p === '/forward') {
    const result = await actions.goForward(tabId);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return result;
  }

  if (method === 'POST' && p === '/reload') {
    const result = await actions.reload(tabId);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return result;
  }

  if (method === 'GET' && p === '/read') {
    return actions.runScript(tabId, domReadScript(num(q('maxChars'))));
  }

  if (method === 'GET' && p === '/snapshot') {
    return actions.runScript(tabId, domSnapshotScript(num(q('maxEls')), elementStash));
  }

  if (method === 'POST' && p === '/click') {
    const index = num(body.index);
    if (index === undefined) throw new HttpError(400, 'index required');
    const found = await actions.runScript(tabId, domClickScript(index, num(body.v), elementStash));
    if (found === 'stale') throw new HttpError(409, 'stale snapshot');
    if (found !== true) throw new HttpError(404, `no element at index ${index} (stale snapshot?)`);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return { ok: true };
  }

  if (method === 'POST' && p === '/type') {
    const index = num(body.index);
    if (index === undefined) throw new HttpError(400, 'index required');
    const found = await actions.runScript(
      tabId,
      domTypeScript(index, str(body.text) ?? '', body.submit === true, num(body.v), elementStash),
    );
    if (found === 'stale') throw new HttpError(409, 'stale snapshot');
    if (found !== true) throw new HttpError(404, `no element at index ${index} (stale snapshot?)`);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return { ok: true };
  }

  if (method === 'POST' && p === '/scroll') {
    const direction = str(body.direction);
    if (!direction) throw new HttpError(400, 'direction required');
    await actions.runScript(tabId, domScrollScript(direction, num(body.amount)));
    actions.markAgentControlled(tabId);
    return { ok: true };
  }

  // --- Trusted input (CDP): for canvas-rendered apps where synthetic events
  // are ignored. Coordinates are viewport CSS pixels (snapshot bbox space).

  if (method === 'POST' && p === '/click-at') {
    const x = num(body.x);
    const y = num(body.y);
    if (x === undefined || y === undefined) throw new HttpError(400, 'x and y required');
    await actions.clickAt(tabId, x, y);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return { ok: true };
  }

  if (method === 'POST' && p === '/press') {
    const key = str(body.key);
    if (!key) throw new HttpError(400, 'key required');
    const modifiers = Array.isArray(body.modifiers)
      ? body.modifiers.filter((m): m is string => typeof m === 'string')
      : undefined;
    await actions.pressKey(tabId, key, modifiers);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return { ok: true };
  }

  if (method === 'POST' && p === '/insert-text') {
    const text = str(body.text);
    if (text === undefined) throw new HttpError(400, 'text required');
    await actions.insertText(tabId, text);
    actions.markAgentControlled(tabId);
    return { ok: true };
  }

  if (method === 'POST' && p === '/paste') {
    const text = str(body.text);
    if (text === undefined) throw new HttpError(400, 'text required');
    const result = await actions.pasteText(tabId, text);
    actions.markAgentControlled(tabId);
    await actions.waitForLoadSettle(tabId);
    return result;
  }

  if (method === 'POST' && p === '/screenshot') {
    const png = await actions.capturePng(tabId);
    const viewport = await actions.viewportInfo(tabId).catch(() => null);
    return { path: actions.saveScreenshot(png), ...(viewport ?? {}) };
  }

  if (method === 'GET' && p === '/top-sites') {
    return actions.topSites(num(q('limit')));
  }

  if (method === 'GET' && p === '/apps') {
    return actions.listApps();
  }

  if (method === 'POST' && p === '/apps/open') {
    const appId = str(body.appId);
    if (!appId) throw new HttpError(400, 'appId required');
    const result = await actions.openApp(appId);
    if ('error' in result) throw new HttpError(404, result.error);
    actions.markAgentControlled(result.tabId);
    await actions.waitForLoadSettle(result.tabId);
    return result;
  }

  throw new HttpError(404, `unknown route: ${method} ${p}`);
}

/** Start the bridge. Idempotent — a second call returns the running handle. */
export async function startBridge(
  actions: BridgeActions,
  opts: { elementStash?: string } = {},
): Promise<BridgeHandle> {
  if (running) {
    return { port: running.port, token: running.token, close: stopBridge };
  }
  if (opts.elementStash) elementStash = opts.elementStash;
  const token = crypto.randomBytes(32).toString('hex');

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/health') {
          return sendJson(res, 200, { ok: true });
        }
        if (!tokenOk(req.headers.authorization, token)) {
          return sendJson(res, 401, { error: 'unauthorized' });
        }
        const body = req.method === 'POST' ? await readBody(req) : {};
        const result = await route(req, url, body, actions);
        sendJson(res, 200, result);
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: err.message });
        } else if (err instanceof BrowserRequestError) {
          // Client-fixable request errors (blocked url, caps) — 400, not 500.
          sendJson(res, 400, { error: err.message });
        } else {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  running = { server, port, token };

  return { port, token, close: stopBridge };
}

export async function stopBridge(): Promise<void> {
  const current = running;
  running = null;
  if (!current) return;
  await new Promise<void>((resolve) => {
    current.server.close(() => resolve());
  });
}
