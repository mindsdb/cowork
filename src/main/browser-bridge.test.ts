import * as http from 'http';
import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Bridge, MAX_BODY_BYTES, startBridge, tokenMatches } from './browser-bridge';
import { fakeHost } from '../../tests/browser-fake-tabs';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let bridge: Bridge;
let token: string;
let host: ReturnType<typeof fakeHost>;

function call(
  method: string,
  path: string,
  options: { body?: unknown; raw?: Buffer; headers?: Record<string, string>; auth?: string | null } = {},
): Promise<Reply> {
  const payload = options.raw ?? (options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body)));
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const auth = options.auth === undefined ? token : options.auth;
  if (auth !== null) headers.authorization = `Bearer ${auth}`;
  if (payload) headers['content-type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: bridge.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const json = (reply: Reply) => JSON.parse(reply.body);

beforeEach(async () => {
  token = randomBytes(32).toString('base64url');
  host = fakeHost();
  bridge = await startBridge({ token: () => token, sessions: host.sessions, store: () => host.store });
});

afterEach(async () => {
  await bridge.close();
  host.cleanup();
  vi.restoreAllMocks();
});

describe('who may call the bridge', () => {
  it('listens on 127.0.0.1 only', () => {
    expect(bridge.url).toBe(`http://127.0.0.1:${bridge.port}`);
  });

  it.each([
    ['no key', null],
    ['a wrong key', randomBytes(32).toString('base64url')],
    ['a short key', 'abc'],
  ])('answers 401 to %s', async (_name, auth) => {
    const reply = await call('GET', '/healthz', { auth });
    expect(reply.status).toBe(401);
    expect(json(reply)).toEqual({ error: 'unauthorized', message: 'missing or invalid credential' });
  });

  it('refuses the old key once the key changes', async () => {
    const old = token;
    expect((await call('GET', '/healthz')).status).toBe(200);
    token = randomBytes(32).toString('base64url');
    expect((await call('GET', '/healthz', { auth: old })).status).toBe(401);
    expect((await call('GET', '/healthz')).status).toBe(200);
  });

  it.each([
    ['a wrong host', { host: 'localhost' }],
    ['a rebinding host', { host: 'evil.example:80' }],
    ['an Origin', { origin: 'https://evil.example' }],
    ['a null Origin', { origin: 'null' }],
    ['a web fetch', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }],
  ])('answers 403 to %s, even with the key', async (_name, headers) => {
    const reply = await call('GET', '/healthz', { headers });
    expect(reply.status).toBe(403);
    expect(json(reply).error).toBe('forbidden');
  });

  it('sends no CORS headers', async () => {
    const reply = await call('GET', '/healthz');
    expect(Object.keys(reply.headers).filter((name) => name.startsWith('access-control'))).toEqual([]);
  });

  it('answers 413 over 1 MB', async () => {
    const reply = await call('POST', '/sessions', { raw: Buffer.alloc(MAX_BODY_BYTES + 10, 0x20) });
    expect(reply.status).toBe(413);
    expect(json(reply).error).toBe('too_large');
  });

  it('never writes the key into its diagnostics', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    }
    await call('GET', '/healthz', { auth: `${token}x` });
    await call('GET', '/healthz', { headers: { origin: 'https://evil.example' } });
    await call('POST', '/sessions', { raw: Buffer.from('{bad') });
    await call('GET', '/healthz');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(token);
  });

  it('compares keys only of the launch key form', () => {
    expect(tokenMatches(`Bearer ${token}`, token)).toBe(true);
    expect(tokenMatches(`Bearer ${token}`, '')).toBe(false);
    expect(tokenMatches(token, token)).toBe(false);
  });
});

describe('routes', () => {
  it('answers healthz with the API version', async () => {
    expect(json(await call('GET', '/healthz'))).toEqual({ ok: true, api: 1 });
  });

  it.each([
    ['POST', '/sessions/t-a/_embed'],
    ['GET', '/sessions/t-a/_embed'],
    ['GET', '/sessions'],
    ['GET', '/sessions/t-a/eval'],
    ['GET', '/sessions/t-a/cookies'],
    ['GET', '/nope'],
  ])('answers 404 to %s %s', async (method, path) => {
    const reply = await call(method, path);
    expect(reply.status).toBe(404);
    expect(json(reply).error).toBe('not_found');
  });

  it('opens a session idempotently', async () => {
    expect((await call('POST', '/sessions', { body: { session_id: 't-a', url: 'https://a.test/' } })).status).toBe(201);
    expect((await call('POST', '/sessions', { body: { session_id: 't-a' } })).status).toBe(200);
    expect((await call('POST', '/sessions', { body: { session_id: '../x' } })).status).toBe(400);
  });

  it('refuses holder agent with 403 person_only', async () => {
    await call('POST', '/sessions', { body: { session_id: 't-a' } });
    const reply = await call('POST', '/sessions/t-a/control', { body: { holder: 'agent', reason: '' } });
    expect(reply.status).toBe(403);
    expect(json(reply)).toEqual({ error: 'person_only', message: 'only the person hands the browser back' });
  });

  it('answers 409 human_in_control while the person holds the browser, and GET /sessions/{id} still answers', async () => {
    await call('POST', '/sessions', { body: { session_id: 't-a' } });
    await call('POST', '/sessions/t-a/control', { body: { holder: 'human', reason: 'Sign in' } });
    const page = await call('GET', '/sessions/t-a/page');
    expect(page.status).toBe(409);
    expect(json(page)).toEqual({ error: 'human_in_control', message: 'The person is using the browser (Sign in).' });
    const info = await call('GET', '/sessions/t-a');
    expect(info.status).toBe(200);
    expect(json(info).control).toMatchObject({ holder: 'human', seq: 1, by: 'agent' });
  });

  it('sends the screenshot as JPEG with its size', async () => {
    await call('POST', '/sessions', { body: { session_id: 't-a' } });
    const reply = await call('GET', '/sessions/t-a/screenshot?annotate=true&format=jpeg&quality=70');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('image/jpeg');
    expect(reply.headers['x-image-width']).toBe('1024');
    expect(reply.headers['x-image-height']).toBe('640');
    expect(host.factory.tabs[0].screenshot).toHaveBeenCalledWith(true, 70);
  });

  it('refuses a step with a string element id', async () => {
    const reply = await call('POST', '/sessions/t-a/action', { body: { action: 'click', element: '7' } });
    expect(reply.status).toBe(400);
    expect(json(reply).error).toBe('bad_request');
  });

  it('answers 503 once the window is gone', async () => {
    host.sessions.setAvailable(false);
    const reply = await call('GET', '/sessions/t-a/page');
    expect(reply.status).toBe(503);
    expect(json(reply)).toEqual({ error: 'browser_unavailable', message: "the app's window is closed" });
  });

  it('saves, lists and deletes a project\'s tabs', async () => {
    const saved = await call('POST', '/saved-tabs', { body: { project: 'p-1', name: 'Report', url: 'https://a.test/', notes: '' } });
    expect(json(saved).tab).toMatchObject({ name: 'Report', url: 'https://a.test/' });
    expect(json(await call('GET', '/saved-tabs?project=p-1')).tabs).toHaveLength(1);
    expect((await call('GET', '/saved-tabs?project=')).status).toBe(400);
    expect(json(await call('DELETE', '/saved-tabs?project=p-1&name=Report'))).toEqual({ ok: true });
    expect(json(await call('GET', '/saved-tabs?project=p-1')).tabs).toEqual([]);
  });

  it("drops a site's record, leaving its cookies, and refuses a malformed site", async () => {
    await call('POST', '/sessions/t-a/sites', { body: { site: 'github.com', account_hint: 'ada' } });
    await call('POST', '/sessions/t-a/sites', { body: { site: 'gitlab.com', account_hint: 'ada' } });
    expect(json(await call('DELETE', '/sessions/t-a/sites/GitHub.com'))).toEqual({ ok: true });
    expect(json(await call('GET', '/sessions/t-a/sites')).sites.map((s: { site: string }) => s.site)).toEqual(['gitlab.com']);
    expect(json(await call('DELETE', '/sessions/t-a/sites/github.com'))).toEqual({ ok: true });
    expect((await call('DELETE', '/sessions/t-a/sites/not%20a%20site')).status).toBe(400);
  });

  it('notes a site and reads its cookies live', async () => {
    await call('POST', '/sessions', { body: { session_id: 't-a' } });
    const noted = json(await call('POST', '/sessions/t-a/sites', { body: { site: 'GitHub.com', account_hint: 'ada' } }));
    expect(noted.site).toMatchObject({ site: 'github.com', account_hint: 'ada', cookies_present: true });
    expect(json(await call('GET', '/sessions/t-a/sites')).sites).toHaveLength(1);
  });
});
