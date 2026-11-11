import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_REGISTRATION_PATH, BrowserRegistration, composeStartedHook } from './browser-register';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function registration(answer: (n: number) => Promise<{ ok: boolean; status: number }>, port: number | null = 26866) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return answer(sent.length) as unknown as Response;
  });
  const reg = new BrowserRegistration({
    serverPort: () => port,
    authHeader: () => ({ Authorization: 'Bearer sidecar-key' }),
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { reg, sent, fetch };
}

const ADDRESS = { url: 'http://127.0.0.1:51234', token: 'k'.repeat(43) };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrowserRegistration', () => {
  it('PUTs the address with the server\'s own key', async () => {
    const { reg, sent } = registration(async () => ({ ok: true, status: 200 }));
    expect(await reg.push(ADDRESS)).toBe(true);
    expect(sent).toEqual([{
      url: `http://127.0.0.1:26866${BROWSER_REGISTRATION_PATH}`,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sidecar-key' },
      body: ADDRESS,
    }]);
  });

  it('clears with an empty pair', async () => {
    const { reg, sent } = registration(async () => ({ ok: true, status: 200 }));
    await reg.push(null);
    expect(sent[0].body).toEqual({ url: '', token: '' });
  });

  it('sends nothing while no server runs', async () => {
    const { reg, fetch } = registration(async () => ({ ok: true, status: 200 }), null);
    expect(await reg.push(ADDRESS)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps pushes in order, so a clear never overtakes the set after it', async () => {
    let releaseFirst: () => void = () => {};
    const { reg, sent } = registration((n) => (n === 1
      ? new Promise((resolve) => { releaseFirst = () => resolve({ ok: true, status: 200 }); })
      : Promise.resolve({ ok: true, status: 200 })));
    const cleared = reg.push(null);
    const set = reg.push(ADDRESS);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    releaseFirst();
    await Promise.all([cleared, set]);
    expect(sent.map((s) => s.body)).toEqual([{ url: '', token: '' }, ADDRESS]);
  });

  it('leaves the browser off on a server that predates the route, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reg } = registration(async () => ({ ok: false, status: 404 }));
    expect(await reg.push(ADDRESS)).toBe(false);
    expect(await reg.push(ADDRESS)).toBe(false);
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines.filter((line) => line.includes('predates'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain(ADDRESS.token);
  });

  it('answers false, without the key in its log, when the server refuses or is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await registration(async () => ({ ok: false, status: 403 })).reg.push(ADDRESS)).toBe(false);
    expect(await registration(async () => { throw new Error('ECONNREFUSED'); }).reg.push(ADDRESS)).toBe(false);
    expect(warn.mock.calls.map(([line]) => String(line)).join('\n')).not.toContain(ADDRESS.token);
  });
});

describe('composeStartedHook', () => {
  it('runs the credential hand-off and then the browser push', async () => {
    const order: string[] = [];
    await composeStartedHook(
      async () => { order.push('credential'); },
      async () => { order.push('browser'); },
    )();
    expect(order).toEqual(['credential', 'browser']);
  });

  it('runs the browser push even when the hand-off fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    await composeStartedHook(
      async () => { order.push('credential'); throw new Error('down'); },
      async () => { order.push('browser'); },
    )();
    expect(order).toEqual(['credential', 'browser']);
  });
});
