/*
 * The in-app browser's HTTP bridge: the routes anton's browser tool calls,
 * served by Electron main on 127.0.0.1 only.
 *
 * Every request must carry this launch's key as `Authorization: Bearer`,
 * compared in constant time. The Host header must be exactly
 * 127.0.0.1:<port>, which refuses DNS rebinding, and any request a web browser
 * sends (it carries Origin or Sec-Fetch-* headers) is refused, so no page in
 * any browser can drive this one. No CORS headers are ever sent. Bodies are
 * capped at 1 MB. There is no route that runs script or exports cookies, and
 * no /_embed: the desktop pane shows the browser natively.
 *
 * Answers follow the shared contract (src/shared/browser-contract.ts);
 * refusals are `{error, message}`.
 */

import * as http from 'http';
import { timingSafeEqual } from 'crypto';
import type { AddressInfo } from 'net';
import { diagnostic } from '../shared/diagnostics';
import {
  BRIDGE_ERROR_STATUS,
  BRIDGE_TOKEN_PATTERN,
  BridgeError,
  BROWSER_HOST_API,
  bridgeUrl,
  parseControlRequest,
  parseNewTab,
  parseNoteSite,
  parseOpenSession,
  parseSaveTab,
  parseStepRequest,
  type Parsed,
  PROJECT_PATTERN,
  SESSION_ID_PATTERN,
  type OpenSessionAnswer,
} from '../shared/browser-contract';
import type { BrowserSessions } from './browser-sessions';
import type { BrowserStore } from './browser-store';
import { jpegQuality } from './browser-screenshot';

export const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_TEXT = 3000;
const MAX_MAX_TEXT = 100_000;

export interface BridgeDeps {
  /** This launch's key; read on every request, so a new key refuses the old one at once. */
  token(): string;
  sessions: BrowserSessions;
  /** The signed-in account's store. */
  store(): BrowserStore;
}

export interface Bridge {
  port: number;
  url: string;
  close(): Promise<void>;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

function sendError(res: http.ServerResponse, error: BridgeError): void {
  sendJson(res, error.status, error.body());
}

/* Constant-time comparison of the presented key with this launch's. A wrong
   length is refused before the comparison, which only reveals the length. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header || !header.startsWith('Bearer ') || !BRIDGE_TOKEN_PATTERN.test(token)) return false;
  const presented = Buffer.from(header.slice('Bearer '.length), 'utf-8');
  const expected = Buffer.from(token, 'utf-8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/* Who may call: anton's client, with the key, at the exact loopback host,
   from outside any web browser. */
function refusal(req: http.IncomingMessage, port: number, token: string): BridgeError | null {
  if (req.headers.host !== `127.0.0.1:${port}`) return new BridgeError('forbidden', 'wrong host');
  const fromBrowser = req.headers.origin !== undefined
    || Object.keys(req.headers).some((name) => name.startsWith('sec-fetch-'));
  if (fromBrowser) return new BridgeError('forbidden', 'requests from a web page are refused');
  if (!tokenMatches(req.headers.authorization, token)) return new BridgeError('unauthorized', 'missing or invalid credential');
  return null;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new BridgeError('too_large', `bodies are limited to ${MAX_BODY_BYTES} bytes`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BridgeError('too_large', `bodies are limited to ${MAX_BODY_BYTES} bytes`));
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      if (!size) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new BridgeError('bad_request', 'the body is not JSON'));
      }
    });
  });
}

function checked<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) throw new BridgeError('bad_request', parsed.message);
  return parsed.value;
}

function sessionId(raw: string): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new BridgeError('bad_request', 'the session id is not valid');
  }
  if (!SESSION_ID_PATTERN.test(id)) throw new BridgeError('bad_request', 'the session id must match [A-Za-z0-9_-]{1,64}');
  return id;
}

function project(params: URLSearchParams): string {
  const value = params.get('project') ?? '';
  if (!PROJECT_PATTERN.test(value)) throw new BridgeError('bad_request', 'project must match [A-Za-z0-9_-]{1,64}');
  return value;
}

function maxText(params: URLSearchParams): number {
  const raw = params.get('max_text');
  if (raw === null) return DEFAULT_MAX_TEXT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new BridgeError('bad_request', 'max_text must be a non-negative integer');
  return Math.min(value, MAX_MAX_TEXT);
}

const notFound = (method: string, path: string) => new BridgeError('not_found', `no route for ${method} ${path}`);

async function route(deps: BridgeDeps, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  const { sessions } = deps;

  if (method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, api: BROWSER_HOST_API });
    return;
  }

  if (parts[0] === 'saved-tabs' && parts.length === 1) {
    if (method === 'GET') {
      sendJson(res, 200, { tabs: deps.store().savedTabs(project(url.searchParams)) });
      return;
    }
    if (method === 'POST') {
      const body = checked(parseSaveTab(await readBody(req)));
      sendJson(res, 200, { tab: deps.store().saveTab(body.project, body) });
      return;
    }
    if (method === 'DELETE') {
      const name = url.searchParams.get('name') ?? '';
      if (!name) throw new BridgeError('bad_request', 'name is required');
      deps.store().deleteSavedTab(project(url.searchParams), name);
      sendJson(res, 200, { ok: true });
      return;
    }
    throw notFound(method, url.pathname);
  }

  if (parts[0] !== 'sessions') throw notFound(method, url.pathname);

  if (parts.length === 1) {
    if (method !== 'POST') throw notFound(method, url.pathname);
    const body = checked(parseOpenSession(await readBody(req)));
    const { created, url: pageUrl } = sessions.open(body.sessionId, body.url);
    const answer: OpenSessionAnswer = { session_id: body.sessionId, resumed: !created, url: pageUrl };
    sendJson(res, created ? 201 : 200, answer);
    return;
  }

  const id = sessionId(parts[1]);
  const rest = parts.slice(2);
  const key = `${method} ${rest.length ? rest[0] : ''}`;

  if (rest.length === 0) {
    if (method === 'GET') {
      sendJson(res, 200, sessions.info(id));
      return;
    }
    if (method === 'DELETE') {
      sessions.close(id);
      sendJson(res, 200, { ok: true });
      return;
    }
    throw notFound(method, url.pathname);
  }

  if (rest[0] === 'tabs') {
    if (rest.length === 1 && method === 'GET') {
      sendJson(res, 200, { tabs: await sessions.tabs(id) });
      return;
    }
    if (rest.length === 1 && method === 'POST') {
      const body = checked(parseNewTab(await readBody(req)));
      sendJson(res, 200, { tab: await sessions.newTab(id, body.url) });
      return;
    }
    if (rest.length === 3 && rest[2] === 'activate' && method === 'POST') {
      sendJson(res, 200, { tab: await sessions.activateTab(id, decodeURIComponent(rest[1])) });
      return;
    }
    if (rest.length === 2 && method === 'DELETE') {
      await sessions.closeTab(id, decodeURIComponent(rest[1]));
      sendJson(res, 200, { ok: true });
      return;
    }
    throw notFound(method, url.pathname);
  }

  /* DELETE /sessions/{id}/sites/{site}: drops the site's record, not its
     cookies, as the web pod does. Signing out of a site is Sign out of all
     sites in Settings. */
  if (rest[0] === 'sites' && rest.length === 2 && method === 'DELETE') {
    let raw = '';
    try {
      raw = decodeURIComponent(rest[1]);
    } catch {
      throw new BridgeError('bad_request', 'site must be a host name such as example.com');
    }
    const { site } = checked(parseNoteSite({ site: raw }));
    await sessions.sites(id, []);
    deps.store().forgetSite(site);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (rest.length !== 1) throw notFound(method, url.pathname);

  switch (key) {
    case 'GET page':
      sendJson(res, 200, await sessions.page(id, maxText(url.searchParams)));
      return;
    case 'POST action':
      sendJson(res, 200, await sessions.action(id, checked(parseStepRequest(await readBody(req)))));
      return;
    case 'GET screenshot': {
      const format = url.searchParams.get('format') ?? 'jpeg';
      if (format !== 'jpeg') throw new BridgeError('bad_request', 'format must be jpeg');
      const shot = await sessions.screenshot(id, url.searchParams.get('annotate') === 'true', jpegQuality(url.searchParams.get('quality')));
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': shot.jpeg.length,
        'cache-control': 'no-store',
        'x-image-width': String(shot.width),
        'x-image-height': String(shot.height),
      });
      res.end(shot.jpeg);
      return;
    }
    case 'POST control': {
      const parsed = parseControlRequest(await readBody(req));
      if (!parsed.ok) throw new BridgeError(parsed.personOnly ? 'person_only' : 'bad_request', parsed.message);
      sendJson(res, 200, sessions.control(id, parsed.value));
      return;
    }
    case 'GET sites':
      sendJson(res, 200, { sites: await sessions.sites(id, deps.store().sites()) });
      return;
    case 'POST sites': {
      const body = checked(parseNoteSite(await readBody(req)));
      const record = deps.store().noteSite(body.site, body.accountHint);
      const [site] = await sessions.sites(id, [record]);
      sendJson(res, 200, { site });
      return;
    }
    default:
      throw notFound(method, url.pathname);
  }
}

/** Starts the bridge on 127.0.0.1 and a free port. */
export function startBridge(deps: BridgeDeps): Promise<Bridge> {
  const server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const refused = refusal(req, port, deps.token());
    if (refused) {
      diagnostic('main.browser-bridge', 'WARNING', `browser_bridge_refused_${refused.code}`, { status: refused.status });
      req.resume();
      sendError(res, refused);
      return;
    }
    route(deps, req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof BridgeError) {
        if (error.code === 'too_large') res.setHeader('connection', 'close');
        sendError(res, error);
        return;
      }
      diagnostic('main.browser-bridge', 'ERROR', 'browser_bridge_route_failed', error);
      sendJson(res, BRIDGE_ERROR_STATUS.internal, { error: 'internal', message: 'the browser failed to answer' });
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        url: bridgeUrl(port),
        close: () => new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}
