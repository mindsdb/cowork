// On web there is no main process: the custom MCP wrappers call cowork-server's
// org-mode routes with the member's token, open the sign-in pop-up inside the
// click, and bound every request with their own timer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/keycloak', () => ({ getAccessToken: vi.fn(async () => 'member-token') }));

import { host, isWeb } from './host';

type Call = { method: string; path: string; body: unknown; signal: AbortSignal; headers: Record<string, string> };
type Answer = { status: number; body?: unknown } | 'hang';

const ROUTES = '/api/v1/connectors/custom-mcp';
const NAME = `cm-${'a'.repeat(32)}`;
const URL_ = 'https://mcp.example.com/mcp';
let calls: Call[] = [];
let answer: (call: Call) => Answer = () => ({ status: 500 });

function respond(call: Call): Promise<Response> {
  const result = answer(call);
  if (result === 'hang') {
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (call.signal.aborted) abort();
      call.signal.addEventListener('abort', abort);
    });
  }
  const body = result.body === undefined ? null : JSON.stringify(result.body);
  return Promise.resolve(new Response(body, { status: result.status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = {
      method: init?.method || 'GET',
      path: url.pathname.replace(ROUTES, '') + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      signal: init?.signal as AbortSignal,
      headers: init?.headers as Record<string, string>,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The wrappers load the token and the organization check with import(); let
// those land before fake time moves, so a request is in flight when it does.
async function untilSent(count: number) {
  for (let round = 0; round < 10 && calls.length < count; round += 1) await vi.dynamicImportSettled();
  expect(calls).toHaveLength(count);
}

function fakePopup() {
  return { opener: 'the Cowork tab' as unknown, location: { href: '' }, close: vi.fn() };
}

describe('custom MCP on web', () => {
  it('is available only when /config says so, with the member token', async () => {
    expect(isWeb).toBe(true);
    answer = () => ({ status: 200, body: { available: true, redirect_uri: 'https://auth.example.com/v1/oauth/custom-mcp/callback' } });
    expect(await host.customMcpAvailable()).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/config' });
    expect(calls[0].headers.Authorization).toBe('Bearer member-token');
    expect(await host.customMcpRedirectUri()).toBe('https://auth.example.com/v1/oauth/custom-mcp/callback');

    answer = () => ({ status: 200, body: { available: false } });
    expect(await host.customMcpAvailable()).toBe(false);
    answer = () => ({ status: 409, body: { detail: 'org_mode_only' } });
    expect(await host.customMcpAvailable()).toBe(false);
  });

  it('asks for the login hosts first and opens no pop-up for that', async () => {
    const open = vi.spyOn(window, 'open');
    answer = () => ({ status: 200, body: { status: 'confirm_login_hosts', login_hosts: ['auth.example.com'] } });

    const result = await host.customMcpConnect({ label: 'Tracker', url: URL_, clientId: 'cid' });

    expect(result).toEqual({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/connect', body: { label: 'Tracker', server_url: URL_, client_id: 'cid' } });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the pop-up before any await with no opener, then signs in and polls', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    let polls = 0;
    answer = (call) => {
      if (call.path === '/connect') return { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/authorize?x=1', state: 'st', name: NAME } };
      polls += 1;
      return polls < 2
        ? { status: 200, body: { status: 'pending' } }
        : { status: 200, body: { status: 'success', id: 7, label: 'Tracker', server_url: URL_, tools_on: 2, tools_unavailable: false } };
    };

    const connecting = host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(popup.opener).toBeNull();
    expect(calls).toHaveLength(0);
    await untilSent(1);
    await vi.advanceTimersByTimeAsync(3000);
    await untilSent(2);
    await vi.advanceTimersByTimeAsync(3000);
    await untilSent(3);

    expect(await connecting).toEqual({ ok: true, id: NAME, label: 'Tracker', serverUrl: URL_, toolsOn: 2, toolsUnavailable: false });
    expect(popup.location.href).toBe('https://auth.example.com/authorize?x=1');
    expect(calls.map((call) => call.path)).toEqual(['/connect', '/status?state=st', '/status?state=st']);
    expect(calls[0].body).toMatchObject({ confirmed_login_hosts: ['auth.example.com'] });
    expect(popup.close).toHaveBeenCalled();
  });

  it('answers popup_blocked at once and never polls when the browser blocked the pop-up', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    answer = (call) => (call.path === '/connect'
      ? { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/authorize?x=1', state: 'st', name: NAME } }
      : { status: 200, body: { status: 'pending' } });

    const result = await host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });

    expect(result).toEqual({ ok: false, code: 'popup_blocked', reason: '' });
    expect(calls.map((call) => call.path)).toEqual(['/connect']);
  });

  it('gives requests that can list 60 seconds and the others 10', async () => {
    vi.useFakeTimers();
    answer = () => 'hang';

    const tools = host.customMcpTools(NAME);
    const deleting = host.customMcpDisconnect(NAME);
    await untilSent(2);
    await vi.advanceTimersByTimeAsync(9_999);
    const listing = calls.find((call) => call.method === 'GET');
    const removal = calls.find((call) => call.method === 'DELETE');
    expect(listing?.signal.aborted).toBe(false);
    expect(removal?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await deleting).toMatchObject({ ok: false, code: 'timeout' });
    expect(removal?.signal.aborted).toBe(true);
    expect(listing?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(49_999);
    expect(listing?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await tools).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('ends at Cancel without aborting the poll in flight, which keeps its timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockImplementation(() => fakePopup() as unknown as Window);
    answer = (call) => (call.path === '/connect'
      ? { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/a', state: 'st', name: NAME } }
      : 'hang');

    const connecting = host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
    await untilSent(1);
    await vi.advanceTimersByTimeAsync(3000);
    await untilSent(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(2);

    await host.oauthCancel();
    expect(await connecting).toMatchObject({ ok: false, code: 'login_failed' });
    expect(calls[1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls[1].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('reads the tools, falls back to the stored ones, and saves with their revision', async () => {
    answer = () => ({
      status: 200,
      body: {
        tools_revision: 4,
        stale: true,
        code: 'listing_too_large',
        tools: [{ name: 'search', description: 'Find', read_only: true, allowed: false, usable: true, reason: 'read_only_removed' }],
      },
    });
    expect(await host.customMcpTools(NAME)).toEqual({
      ok: true,
      stale: true,
      staleCode: 'listing_too_large',
      tools: [{ name: 'search', description: 'Find', readOnly: true, allowed: false, usable: true, reason: 'read_only_removed' }],
    });

    answer = () => ({ status: 200, body: { tools_revision: 5, tools: [{ name: 'search', allowed: true, usable: true, read_only: true }] } });
    expect(await host.customMcpSetTools(NAME, ['search'])).toEqual({ ok: true, tools: ['search'] });
    expect(calls[1]).toMatchObject({ method: 'PUT', path: `/connections/${NAME}/tools`, body: { tools: ['search'], tools_revision: 4 } });

    answer = () => ({ status: 409, body: { error: 'stale_revision', detail: 'The tool list changed.' } });
    expect(await host.customMcpSetTools(NAME, [])).toEqual({ ok: false, code: 'stale_revision', reason: 'The tool list changed.' });
    expect(calls[2].body).toMatchObject({ tools_revision: 5 });
  });

  it('passes the port refusal on with its code', async () => {
    answer = () => ({ status: 400, body: { detail: { error: 'port', detail: 'The URL names a port.' } } });
    expect(await host.customMcpConnect({ label: 'T', url: 'https://mcp.example.com:8443/mcp' })).toEqual({ ok: false, code: 'port', reason: 'The URL names a port.' });
  });

  it('finishes a sign-in with a 12 second bound', async () => {
    vi.useFakeTimers();
    answer = () => 'hang';
    const finishing = host.customMcpFinish('c'.repeat(43));
    await untilSent(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/finish', body: { completion: 'c'.repeat(43) } });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(calls[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await finishing).toMatchObject({ ok: false, code: 'timeout' });

    vi.useRealTimers();
    answer = () => ({ status: 403, body: { error: 'login_not_yours', detail: 'x' } });
    expect(await host.customMcpFinish('c'.repeat(43))).toMatchObject({ ok: false, code: 'login_not_yours' });
  });

  it('gives a reconnect the same 12 second bound as finish', async () => {
    vi.useFakeTimers();
    answer = () => 'hang';
    const reconnecting = host.customMcpReconnect(NAME);
    await untilSent(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: `/connections/${NAME}/reconnect` });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(calls[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reconnecting).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('removes a server and has no summary route', async () => {
    answer = () => ({ status: 204 });
    expect(await host.customMcpDisconnect(NAME)).toEqual({ ok: true, revoked: false });
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `/connections/${NAME}` });
    expect(await host.customMcpSummary(NAME)).toMatchObject({ ok: false, code: 'unavailable' });
  });
});
