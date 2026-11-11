import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./server-process', () => ({ getServerPort: () => 4000 }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));

import { fetchNotionPage, searchNotionPages } from './notion-pages';
import { APP_SECRET_HEADER, clearAppSecret, newAppSecret, setServerTrust } from './app-secret';

type Sent = { url: string; headers: Record<string, string>; body: unknown };

/** The local server: answers every request with `status` and `body`. */
function fakeServer(status = 200, body: unknown = { results: [{ id: 'p1' }] }, headers: Record<string, string> = {}): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  }));
  return sent;
}

beforeEach(() => {
  clearAppSecret();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Notion page search and fetch from main', () => {
  it('sends the app secret with the bearer in protected mode and returns the server\'s JSON', async () => {
    const secret = newAppSecret();
    setServerTrust('protected');
    const sent = fakeServer();

    await expect(searchNotionPages('acme', 'roadmap')).resolves.toEqual({ ok: true, data: { results: [{ id: 'p1' }] } });
    await fetchNotionPage('acme', 'https://www.notion.so/p1');

    expect(sent.map((s) => s.url)).toEqual([
      'http://127.0.0.1:4000/api/v1/connectors/notion/search',
      'http://127.0.0.1:4000/api/v1/connectors/notion/fetch',
    ]);
    expect(sent.map((s) => s.body)).toEqual([{ name: 'acme', query: 'roadmap' }, { name: 'acme', page: 'https://www.notion.so/p1' }]);
    for (const s of sent) {
      expect(s.headers[APP_SECRET_HEADER]).toBe(secret);
      expect(s.headers.Authorization).toBe('Bearer bearer');
    }
  });

  it('sends no secret to a legacy server', async () => {
    newAppSecret();
    setServerTrust('legacy');
    const sent = fakeServer();

    await searchNotionPages('acme', 'roadmap');

    expect(Object.keys(sent[0].headers)).not.toContain(APP_SECRET_HEADER);
  });

  it('passes the server\'s refusal through as it was sent', async () => {
    newAppSecret();
    setServerTrust('protected');
    fakeServer(409, { detail: 'Reconnect Notion.' }, { 'Retry-After': '30' });

    await expect(fetchNotionPage('acme', 'p1')).resolves.toEqual({
      ok: false, status: 409, text: JSON.stringify({ detail: 'Reconnect Notion.' }), retryAfter: '30',
    });
  });

  it.each([
    ['an empty name', () => searchNotionPages('', 'roadmap')],
    ['a missing name', () => fetchNotionPage(undefined, 'p1')],
    ['an empty query', () => searchNotionPages('acme', '')],
    ['a query over 200 characters', () => searchNotionPages('acme', 'x'.repeat(201))],
    ['a page over 2000 characters', () => fetchNotionPage('acme', 'x'.repeat(2001))],
    ['a page that is not text', () => fetchNotionPage('acme', 42)],
  ])('refuses %s without a request', async (_label, call) => {
    newAppSecret();
    setServerTrust('protected');
    const sent = fakeServer();

    const result = await call();

    expect(result.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('accepts the longest query and page the server accepts', async () => {
    newAppSecret();
    setServerTrust('protected');
    const sent = fakeServer();

    await searchNotionPages('acme', 'x'.repeat(200));
    await fetchNotionPage('acme', 'x'.repeat(2000));

    expect(sent).toHaveLength(2);
  });

  it.each([
    ['untrusted', 'The backend could not be verified. Restart Cowork and try again.'],
    ['none', 'The backend is not running.'],
  ] as const)('sends nothing while the server is %s', async (trust, reason) => {
    newAppSecret();
    setServerTrust(trust);
    const sent = fakeServer();

    await expect(searchNotionPages('acme', 'roadmap')).resolves.toEqual({ ok: false, reason });
    await expect(fetchNotionPage('acme', 'p1')).resolves.toEqual({ ok: false, reason });

    expect(sent).toEqual([]);
  });
});
