// On web there is no main process: the custom MCP wrappers call cowork-server's
// org-mode routes with the member's token, open the sign-in pop-up inside the
// click, and bound every request with their own timer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/keycloak', () => ({ getAccessToken: vi.fn(async () => 'member-token') }));

import { getAccessToken } from '../lib/keycloak';
import { __resetOrganizationRequestBoundaryForTests } from '../cowork/lib/organizationRequestBoundary';
import { nudgeCustomMcpSignIns } from '../cowork/lib/customMcpWebConnect';
import { host, isWeb } from './host';

type Call = { method: string; path: string; body: unknown; signal: AbortSignal; headers: Record<string, string> };
type Answer = { status: number; body?: unknown } | 'hang';

const ROUTES = '/api/v1/connectors/custom-mcp';
const NAME = `cm-${'a'.repeat(32)}`;
const ORG = '11111111-2222-4333-8444-555555555555';
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
  vi.mocked(getAccessToken).mockResolvedValue('member-token');
  __resetOrganizationRequestBoundaryForTests();
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

  it('answers popup_blocked at once and sends nothing when the browser blocked the pop-up', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    answer = (call) => (call.path === '/connect'
      ? { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/authorize?x=1', state: 'st', name: NAME } }
      : { status: 200, body: { status: 'pending' } });

    const connect = await host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
    const reconnect = await host.customMcpReconnect(NAME, ['auth.example.com']);

    expect(connect).toEqual({ ok: false, code: 'popup_blocked', reason: '' });
    expect(reconnect).toEqual({ ok: false, code: 'popup_blocked', reason: '' });
    // auth would keep a pending row for a sign-in no page can finish, counted toward the member's cap.
    expect(calls).toEqual([]);
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
    expect(await connecting).toMatchObject({ ok: false, code: 'stopped_waiting' });
    expect(calls[1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls[1].signal.aborted).toBe(true);
    // The one status read after Cancel, for a sign-in the finish page already saved.
    expect(calls.map((call) => call.path)).toEqual(['/connect', '/status?state=st', '/status?state=st']);
  });

  it('announces a sign-in the finish page saved before Cancel, so the list shows it', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => fakePopup() as unknown as Window);
    let statusReads = 0;
    answer = (call) => {
      if (call.path === '/connect') return { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/a', state: 'st', name: NAME } };
      statusReads += 1;
      return statusReads === 1 ? 'hang' : { status: 200, body: { status: 'success', name: NAME, label: 'Tracker', server_url: URL_, tools_on: 1, tools_unavailable: false } };
    };
    const changed = vi.fn();
    window.addEventListener('anton:connections-changed', changed);
    try {
      vi.useFakeTimers();
      const connecting = host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
      await untilSent(1);
      await vi.advanceTimersByTimeAsync(3000);
      await untilSent(2);

      await host.oauthCancel();
      expect(await connecting).toMatchObject({ ok: false, code: 'stopped_waiting' });
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener('anton:connections-changed', changed);
    }
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
      revision: 4,
      tools: [{ name: 'search', description: 'Find', readOnly: true, allowed: false, usable: true, reason: 'read_only_removed' }],
    });

    answer = () => ({ status: 200, body: { tools_revision: 5, tools: [{ name: 'search', allowed: true, usable: true, read_only: true }] } });
    expect(await host.customMcpSetTools(NAME, ['search'], 4)).toEqual({
      ok: true,
      tools: ['search'],
      saved: [{ name: 'search', description: '', readOnly: true, allowed: true, usable: true, reason: null }],
      revision: 5,
    });
    expect(calls[1]).toMatchObject({ method: 'PUT', path: `/connections/${NAME}/tools`, body: { tools: ['search'], tools_revision: 4 } });

    answer = () => ({ status: 409, body: { error: 'stale_revision', detail: 'The tool list changed.' } });
    expect(await host.customMcpSetTools(NAME, [], 5)).toEqual({ ok: false, code: 'stale_revision', reason: 'The tool list changed.' });
    expect(calls[2].body).toMatchObject({ tools_revision: 5 });
  });

  it('keeps the list on screen when a save answer carries no whole list', async () => {
    answer = () => ({ status: 200, body: { tools_revision: 6 } });
    expect(await host.customMcpSetTools(NAME, ['search'], 5)).toEqual({ ok: true, tools: [] });
    answer = () => ({ status: 200, body: { tools: [{ name: 'search', allowed: true }] } });
    expect(await host.customMcpSetTools(NAME, ['search'], 5)).toEqual({ ok: true, tools: ['search'] });
  });

  it('refuses a save with no revision read, without asking the server', async () => {
    expect(await host.customMcpSetTools(NAME, ['search'])).toEqual({ ok: false, code: 'stale_revision', reason: '' });
    expect(calls).toHaveLength(0);
  });

  it('ends at Cancel during the first request, and announces a server it still added', async () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    let finishConnect: (value: Answer) => void = () => {};
    answer = () => 'hang';
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method || 'GET', path: new URL(String(input)).pathname.replace(ROUTES, ''), body: undefined, signal: init?.signal as AbortSignal, headers: {} });
      return new Promise<Response>((resolve) => {
        finishConnect = (value) => {
          if (value !== 'hang') resolve(new Response(JSON.stringify(value.body), { status: value.status }));
        };
      });
    }) as typeof fetch;

    const changed = vi.fn();
    window.addEventListener('anton:connections-changed', changed);
    try {
      const connecting = host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
      await untilSent(1);
      await host.oauthCancel();
      expect(await connecting).toMatchObject({ ok: false, code: 'stopped_waiting' });
      expect(changed).not.toHaveBeenCalled();

      finishConnect({ status: 200, body: { status: 'connected', name: NAME, label: 'Tracker', server_url: URL_, tools_on: 1, tools_unavailable: false } });
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener('anton:connections-changed', changed);
    }
  });

  it.each([
    ['connect', '/connect', () => host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] })],
    ['reconnect', `/connections/${NAME}/reconnect`, () => host.customMcpReconnect(NAME, ['auth.example.com'])],
  ])('opens no login page when Cancel was pressed during the first request (%s)', async (_kind, path, start) => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    let finishConnect: () => void = () => {};
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method || 'GET', path: new URL(String(input)).pathname.replace(ROUTES, ''), body: undefined, signal: init?.signal as AbortSignal, headers: {} });
      return new Promise<Response>((resolve) => {
        finishConnect = () => resolve(new Response(JSON.stringify({ status: 'pending', auth_url: 'https://auth.example.com/a', state: 'st', name: NAME }), { status: 200 }));
      });
    }) as typeof fetch;

    const connecting = start();
    await untilSent(1);
    await host.oauthCancel();
    finishConnect();

    expect(await connecting).toMatchObject({ ok: false, code: 'stopped_waiting' });
    expect(popup.location.href).toBe('');
    expect(calls.map((call) => call.path)).toEqual([path]);
  });

  it('ends at the deadline when the token refresh never settles', async () => {
    vi.useFakeTimers();
    vi.mocked(getAccessToken).mockImplementationOnce(() => new Promise(() => {}));

    const listing = host.customMcpTools(NAME);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await listing).toMatchObject({ ok: false, code: 'timeout' });
    expect(calls).toHaveLength(0);
  });

  it('does not read a success whose body cannot be read as an empty answer', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"tools_revision": 3, "tools": [', { status: 200 })) as typeof fetch;

    expect(await host.customMcpTools(NAME)).toEqual({ ok: false, code: 'unreadable_response', reason: '' });
    expect(await host.customMcpFinish('c'.repeat(43))).toEqual({ ok: false, code: 'unreadable_response', reason: '' });
  });

  it('names an answer it cannot use as unreadable on connect and reconnect', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => fakePopup() as unknown as Window);
    answer = () => ({ status: 200, body: { status: 'weird' } });
    expect(await host.customMcpConnect({ label: 'T', url: URL_ })).toEqual({ ok: false, code: 'unreadable_response', reason: '' });
    expect(await host.customMcpReconnect(NAME)).toEqual({ ok: false, code: 'unreadable_response', reason: '' });

    answer = () => ({ status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/a', name: NAME } });
    expect(await host.customMcpConnect({ label: 'T', url: URL_, confirmedLoginHosts: ['auth.example.com'] })).toEqual({ ok: false, code: 'unreadable_response', reason: '' });
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

  it("shows auth's refusal as soon as the finish page nudges, and leaves the pop-up open", async () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    const detail = "This server's tokens expire and it gives no refresh token, so it cannot be used on cloud.";
    answer = (call) => (call.path === '/connect'
      ? { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/authorize', state: 'st', name: NAME } }
      : { status: 200, body: { status: 'error', name: NAME, error: 'no_refresh_token', detail } });

    const started = Date.now();
    const connecting = host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
    await untilSent(1);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(''));
    nudgeCustomMcpSignIns();

    expect(await connecting).toEqual({ ok: false, code: 'no_refresh_token', reason: detail });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(popup.close).not.toHaveBeenCalled();
    expect(calls.map((call) => call.path)).toEqual(['/connect', '/status?state=st']);
  });

  it("goes by this tab's own status whatever the finish page's request met", async () => {
    // A finish page's /finish can time out at the relay while auth still finishes the sign-in.
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    answer = (call) => (call.path === '/connect'
      ? { status: 200, body: { status: 'pending', auth_url: 'https://auth.example.com/authorize', state: 'st', name: NAME } }
      : { status: 200, body: { status: 'success', label: 'Tracker', server_url: URL_, tools_on: 1, tools_unavailable: false } });

    const connecting = host.customMcpConnect({ label: 'Tracker', url: URL_, confirmedLoginHosts: ['auth.example.com'] });
    await untilSent(1);
    await vi.waitFor(() => expect(popup.location.href).not.toBe(''));
    nudgeCustomMcpSignIns();

    expect(await connecting).toMatchObject({ ok: true, id: NAME, toolsOn: 1 });
    expect(calls.map((call) => call.path)).toEqual(['/connect', '/status?state=st']);
    expect(popup.close).toHaveBeenCalled();
  });

  it("sends the tab's organization and stops at the server's organization-changed answer", async () => {
    const claims = btoa(JSON.stringify({ activate_organization: { id: ORG } })).replace(/=+$/, '');
    vi.mocked(getAccessToken).mockResolvedValue(`h.${claims}.s`);
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method || 'GET', path: new URL(String(input)).pathname.replace(ROUTES, ''), body: undefined, signal: init?.signal as AbortSignal, headers: init?.headers as Record<string, string> });
      return Promise.resolve(new Response(JSON.stringify({ tools_revision: 1, tools: [] }), {
        status: 409, headers: { 'Content-Type': 'application/json', 'X-Cowork-Organization-Reload': 'required' },
      }));
    }) as typeof fetch;

    const answered = await host.customMcpTools(NAME);

    expect(calls[0].headers['X-Cowork-Expected-Organization-Id']).toBe(ORG);
    expect(answered).toEqual({ ok: false, code: 'organization_changed', reason: '' });
  });

  it('sends nothing for a name that is not a connection id', async () => {
    for (const name of ['..', '.', 'cm-x/../config']) {
      expect(await host.customMcpTools(name)).toEqual({ ok: false, code: 'not_found', reason: '' });
      expect(await host.customMcpSetTools(name, [], 1)).toEqual({ ok: false, code: 'not_found', reason: '' });
      expect(await host.customMcpReconnect(name)).toEqual({ ok: false, code: 'not_found', reason: '' });
      expect(await host.customMcpDisconnect(name)).toEqual({ ok: false, code: 'not_found', reason: '' });
    }
    expect(calls).toEqual([]);
  });
});
