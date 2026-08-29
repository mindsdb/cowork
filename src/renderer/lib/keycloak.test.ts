import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERSONAL_ORG_LABEL } from '../../shared/minds-orgs';

// Mock the keycloak-js constructor so importing this module never spins up a
// real client. The returned singleton IS the module's exported `keycloak`, so
// tests toggle `authenticated` on it to drive the two logout branches.
const instance = vi.hoisted(() => ({
  authenticated: false,
  subject: undefined as string | undefined,
  token: undefined as string | undefined,
  tokenParsed: undefined as Record<string, unknown> | undefined,
  onAuthError: undefined as undefined | (() => void),
  login: vi.fn(),
  logout: vi.fn(async () => {}),
  updateToken: vi.fn(async (_minValidity?: number) => false),
  clearToken: vi.fn(),
}));
vi.mock('keycloak-js', () => ({ default: vi.fn(function () { return instance; }) }));

import { MINDS_KEYCLOAK_URL } from './mindsUrls';
import {
  __resetOrganizationTransitionForTests,
  getAccessToken,
  keycloak,
  listWebOrganizations,
  logout,
  switchWebOrganization,
} from './keycloak';
import { beginOrganizationTransition } from '../cowork/lib/organizationTransition';

const realmUrl = `${MINDS_KEYCLOAK_URL.replace(/\/$/, '')}/realms/mindsdb`;
const capabilityUrl = '/api/v1/capabilities/organization-switch';
const enabledCapability = {
  protocolVersion: 1,
  expectedOrganizationEnforced: true,
  enabled: true,
};
let reloadSpy: ReturnType<typeof vi.fn>;
let lockHeld: boolean;
const locks = {
  request: vi.fn(async (
    _name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => unknown,
  ) => {
    if (lockHeld) return callback(null);
    lockHeld = true;
    try {
      return await callback({ name: 'organization-transition', mode: 'exclusive' } as Lock);
    } finally {
      lockHeld = false;
    }
  }),
};

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetchWithCapability(
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  capability: unknown = enabledCapability,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (
    input === capabilityUrl
      ? jsonResponse(200, capability)
      : request(input, init)
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/* The expected-organization header is a UUID on the wire, so pinned ids are too. */
const ORG_A = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const ORG_B = '4e27728a-a002-48b5-8961-0e1ca339d13f';
const ORG_PERSONAL = 'a3f1c0d2-58b7-4a9e-9c31-2d8e6f0b7a45';

function accessToken(organizationId: string): string {
  const payload = btoa(JSON.stringify({
    sub: 'user-1',
    activate_organization: { id: organizationId },
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function signedIn(options: {
  subject?: string;
  token?: string;
  activeOrganization?: unknown;
} = {}): void {
  keycloak.authenticated = true;
  keycloak.subject = options.subject ?? 'user-1';
  keycloak.token = options.token ?? 'access-token';
  keycloak.tokenParsed = {
    sub: options.subject ?? 'user-1',
    activate_organization: options.activeOrganization ?? { id: 'org-personal' },
  };
}

beforeEach(() => {
  __resetOrganizationTransitionForTests();
  lockHeld = false;
  locks.request.mockClear();
  vi.stubGlobal('navigator', { locks });
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
  keycloak.authenticated = false;
  keycloak.subject = undefined;
  keycloak.token = undefined;
  keycloak.tokenParsed = undefined;
  instance.login.mockReset();
  instance.logout.mockReset().mockResolvedValue(undefined);
  instance.updateToken.mockReset().mockResolvedValue(false);
  instance.clearToken.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('keycloak logout()', () => {
  it('no-ops when there is no session (e.g. legacy tenant hosts)', async () => {
    keycloak.authenticated = false;
    await logout();
    expect(instance.logout).not.toHaveBeenCalled();
  });

  it('ends the session through the end-session endpoint when authenticated', async () => {
    keycloak.authenticated = true;
    await logout();
    expect(instance.logout).toHaveBeenCalledTimes(1);
    expect(instance.logout).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: expect.any(String) }),
    );
  });
});

describe('getAccessToken()', () => {
  it('reloads when another origin changes the refreshed session organization', async () => {
    signedIn({ token: accessToken(ORG_A), activeOrganization: { id: ORG_A } });
    instance.updateToken.mockImplementationOnce(async () => {
      keycloak.token = accessToken(ORG_B);
      keycloak.tokenParsed = { sub: 'user-1', activate_organization: { id: ORG_B } };
      return true;
    });

    await expect(getAccessToken())
      .rejects.toThrow('The active organization changed; reload required');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('checks an already-refreshed token before starting another refresh', async () => {
    signedIn({ token: accessToken(ORG_A), activeOrganization: { id: ORG_A } });
    await expect(getAccessToken()).resolves.toBe(keycloak.token);
    instance.updateToken.mockClear();
    keycloak.token = accessToken(ORG_B);

    await expect(getAccessToken())
      .rejects.toThrow('The active organization changed; reload required');
    expect(instance.updateToken).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a refresh that settles after another tab starts a transition', async () => {
    signedIn();
    let finishRefresh: (value: boolean) => void = () => {};
    instance.updateToken.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { finishRefresh = resolve; }),
    );

    const token = getAccessToken();
    await vi.waitFor(() => expect(instance.updateToken).toHaveBeenCalledWith(30));
    await beginOrganizationTransition('user-1');
    finishRefresh(true);

    await expect(token).rejects.toThrow('Organization change is in progress');
  });
});

describe('listWebOrganizations()', () => {
  it('lists the authenticated subject, normalizes labels, and ranks personal last', async () => {
    const subject = 'user/one ?';
    const token = accessToken(ORG_PERSONAL);
    signedIn({
      subject,
      token,
      activeOrganization: { id: ORG_PERSONAL, name: `personal_${subject}` },
    });
    const fetchMock = vi.fn(async () => jsonResponse(200, [
      {
        id: ORG_PERSONAL,
        name: `personal_${subject}`,
        displayName: "dana@example.com's organization",
      },
      { id: 'org-acme', name: 'acme.example', displayName: 'Acme' },
    ]));
    const webFetch = stubFetchWithCapability(fetchMock);

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: true,
      orgs: [
        { id: 'org-acme', name: 'acme.example', displayName: 'Acme', isPersonal: false },
        {
          id: ORG_PERSONAL,
          name: `personal_${subject}`,
          displayName: "dana@example.com's organization",
          isPersonal: true,
        },
      ],
      activeOrgId: ORG_PERSONAL,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${realmUrl}/users/${encodeURIComponent(subject)}/orgs?search=&first=0&max=100`,
      {
        credentials: 'include',
        signal: expect.any(AbortSignal),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(webFetch).toHaveBeenCalledWith(capabilityUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Cowork-Expected-Organization-Id': ORG_PERSONAL,
      },
    });
    expect(instance.updateToken).not.toHaveBeenCalled();
  });

  it.each([
    ['an older server', async () => jsonResponse(404)],
    ['a network failure', async () => { throw new TypeError('offline'); }],
    ['a disabled capability', async () => jsonResponse(200, {
      ...enabledCapability,
      enabled: false,
    })],
    ['an unenforced boundary', async () => jsonResponse(200, {
      ...enabledCapability,
      expectedOrganizationEnforced: false,
    })],
    ['another protocol version', async () => jsonResponse(200, {
      ...enabledCapability,
      protocolVersion: 2,
    })],
  ])('hides organizations behind %s', async (_description, capabilityRequest) => {
    signedIn();
    const organizationRequest = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse(200, []));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => (
      input === capabilityUrl
        ? capabilityRequest()
        : organizationRequest(input, init)
    )));

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: false,
      reason: 'We could not load organizations. Please try again.',
    });
    expect(organizationRequest).not.toHaveBeenCalled();
  });

  it('bounds a capability request that never settles', async () => {
    vi.useFakeTimers();
    signedIn();
    const organizationRequest = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse(200, []));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input !== capabilityUrl) return organizationRequest(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }));

    const result = listWebOrganizations();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'We could not load organizations. Please try again.',
    });
    expect(organizationRequest).not.toHaveBeenCalled();
  });

  it('accepts results and membership wrappers plus a JSON-string active claim', async () => {
    signedIn({
      activeOrganization: JSON.stringify({ name: 'org-acme' }),
    });
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      results: [
        {
          organization: {
            id: 'org-personal',
            name: 'personal_user-1',
            display_name: "lee@example.com's organization",
          },
        },
        { organization: { id: 'org-acme', name: 'org-acme' } },
      ],
    }));
    stubFetchWithCapability(fetchMock);

    const result = await listWebOrganizations();

    expect(result).toEqual({
      ok: true,
      orgs: [
        { id: 'org-acme', name: 'org-acme', displayName: 'org-acme', isPersonal: false },
        {
          id: 'org-personal',
          name: 'personal_user-1',
          displayName: "lee@example.com's organization",
          isPersonal: true,
        },
      ],
      activeOrgId: 'org-acme',
    });
  });

  it('never exposes a raw personal slug when its display name is absent', async () => {
    signedIn();
    stubFetchWithCapability(vi.fn(async () => jsonResponse(200, [
      { id: 'org-personal', name: 'personal_user-1' },
    ])));

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: true,
      orgs: [{
        id: 'org-personal',
        name: 'personal_user-1',
        displayName: PERSONAL_ORG_LABEL,
        isPersonal: true,
      }],
      activeOrgId: 'org-personal',
    });
  });

  it('uses tokenParsed.sub when the adapter has no subject property yet', async () => {
    signedIn();
    keycloak.subject = undefined;
    const fetchMock = vi.fn(async () => jsonResponse(200, []));
    stubFetchWithCapability(fetchMock);

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: true,
      orgs: [],
      activeOrgId: 'org-personal',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/users/user-1/orgs?'),
      expect.any(Object),
    );
  });

  it.each([
    ['a non-list object', {}],
    ['a non-list results field', { results: null }],
    ['a non-object row', [null]],
    ['an organization without an id', [{ name: 'acme.example' }]],
    ['a membership without an organization', [{ id: 'membership-1', organization: null }]],
  ])('fails closed for %s', async (_description, body) => {
    signedIn();
    stubFetchWithCapability(vi.fn(async () => jsonResponse(200, body)));

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: false,
      reason: 'We could not load organizations. Please try again.',
    });
  });

  it('fails closed without an authenticated session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: false,
      reason: 'Sign in to view organizations.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(instance.updateToken).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated subject is missing', async () => {
    signedIn();
    keycloak.subject = undefined;
    keycloak.tokenParsed = {};
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: false,
      reason: 'Could not read the signed-in account.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when token refresh leaves no bearer token', async () => {
    signedIn();
    keycloak.token = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: false,
      reason: 'Sign in to view organizations.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTTP failure', async () => jsonResponse(503)],
    ['a network failure', async () => { throw new TypeError('offline'); }],
    ['an invalid JSON response', async () => new Response('not json', { status: 200 })],
  ])('fails closed after %s', async (_description, request) => {
    signedIn();
    stubFetchWithCapability(vi.fn(request));

    await expect(listWebOrganizations()).resolves.toEqual({
      ok: false,
      reason: 'We could not load organizations. Please try again.',
    });
  });

  it('aborts a hanging list request and fails closed', async () => {
    vi.useFakeTimers();
    signedIn();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }),
    ));
    stubFetchWithCapability(fetchMock);

    const result = listWebOrganizations();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'We could not load organizations. Please try again.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds a list response whose JSON body never settles', async () => {
    vi.useFakeTimers();
    signedIn();
    stubFetchWithCapability(vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: () => new Promise<unknown>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    }) as Response));

    const result = listWebOrganizations();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'We could not load organizations. Please try again.',
    });
  });
});

describe('switchWebOrganization()', () => {
  it.each([
    ['an older server', async () => jsonResponse(404)],
    ['a network failure', async () => { throw new TypeError('offline'); }],
    ['a disabled capability', async () => jsonResponse(200, {
      ...enabledCapability,
      enabled: false,
    })],
  ])('does not send the switch PUT behind %s', async (_description, capabilityRequest) => {
    signedIn();
    const switchRequest = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse(204));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => (
      input === capabilityUrl
        ? capabilityRequest()
        : switchRequest(input, init)
    )));

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'Changing organization is not available. Nothing changed.',
      reloadRequired: false,
      clearTenantState: false,
    });
    expect(switchRequest).not.toHaveBeenCalled();
    expect(locks.request).not.toHaveBeenCalled();
  });

  it('honors a mandatory reload response from the capability boundary', async () => {
    signedIn();
    const switchRequest = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse(204));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input !== capabilityUrl) return switchRequest(input, init);
      return Promise.resolve(new Response(null, {
        status: 426,
        headers: { 'X-Cowork-Organization-Reload': ' required ' },
      }));
    }));

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'We could not confirm the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(switchRequest).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('PUTs the target, forces a refresh, verifies the claim, and requires reload', async () => {
    signedIn();
    instance.updateToken.mockImplementation(async (minValidity) => {
      if (minValidity === -1) {
        keycloak.tokenParsed = { activate_organization: { id: 'org-acme' } };
      }
      return true;
    });
    const fetchMock = vi.fn(async () => jsonResponse(204));
    stubFetchWithCapability(fetchMock);

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: true,
      activeOrgId: 'org-acme',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(`${realmUrl}/users/switch-organization`, {
      method: 'PUT',
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'org-acme' }),
    });
    expect(instance.updateToken.mock.calls.map(([validity]) => validity)).toEqual([30, -1]);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts a refreshed JSON-string claim using its name fallback', async () => {
    signedIn();
    instance.updateToken.mockImplementation(async (minValidity) => {
      if (minValidity === -1) {
        keycloak.tokenParsed = {
          activate_organization: JSON.stringify({ name: 'org-acme' }),
        };
      }
      return true;
    });
    stubFetchWithCapability(vi.fn(async () => jsonResponse(204)));

    await expect(switchWebOrganization('org-acme')).resolves.toMatchObject({
      ok: true,
      activeOrgId: 'org-acme',
    });
  });

  it.each([400, 401, 403, 404])(
    'treats a %s response as a definite refusal',
    async (status) => {
      signedIn();
      stubFetchWithCapability(vi.fn(async () => jsonResponse(status)));

      await expect(switchWebOrganization('org-acme')).resolves.toEqual({
        ok: false,
        reason: 'We could not change organization. Nothing changed.',
        reloadRequired: false,
        clearTenantState: false,
      });
      expect(instance.updateToken).not.toHaveBeenCalledWith(-1);
    },
  );

  it('blocks ordinary token reads while the PUT is pending and unlocks after a refusal', async () => {
    signedIn();
    let resolvePut: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolvePut = resolve; }));
    stubFetchWithCapability(fetchMock);

    const result = switchWebOrganization('org-acme');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await expect(getAccessToken()).rejects.toThrow('Organization change is in progress');
    resolvePut(jsonResponse(403));
    await expect(result).resolves.toMatchObject({ ok: false, reloadRequired: false });
    await expect(getAccessToken()).resolves.toBe('access-token');
  });

  it.each([408, 425, 429, 499, 500, 502, 599])(
    'treats a %s response as possibly committed',
    async (status) => {
      signedIn();
      stubFetchWithCapability(vi.fn(async () => jsonResponse(status)));

      await expect(switchWebOrganization('org-acme')).resolves.toEqual({
        ok: false,
        reason: 'We could not confirm the organization change. Reload to continue.',
        reloadRequired: true,
        clearTenantState: true,
      });
      expect(instance.updateToken).not.toHaveBeenCalledWith(-1);
    },
  );

  it('treats a network failure as possibly committed', async () => {
    signedIn();
    stubFetchWithCapability(vi.fn(async () => { throw new TypeError('offline'); }));

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'We could not confirm the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(instance.updateToken).not.toHaveBeenCalledWith(-1);
  });

  it('aborts a hanging PUT and treats it as possibly committed', async () => {
    vi.useFakeTimers();
    signedIn();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }),
    ));
    stubFetchWithCapability(fetchMock);

    const result = switchWebOrganization('org-acme');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'We could not confirm the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(instance.updateToken).not.toHaveBeenCalledWith(-1);
  });

  it('reports a completed PUT with a failed forced refresh as possibly committed', async () => {
    signedIn();
    instance.updateToken.mockImplementation(async (minValidity) => {
      if (minValidity === -1) throw new Error('refresh failed');
      return false;
    });
    stubFetchWithCapability(vi.fn(async () => jsonResponse(204)));

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'We could not confirm the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(instance.updateToken).toHaveBeenCalledWith(-1);
  });

  it('bounds a hanging forced refresh after the PUT committed', async () => {
    vi.useFakeTimers();
    signedIn();
    instance.updateToken.mockImplementation((minValidity) => (
      minValidity === -1 ? new Promise<boolean>(() => {}) : Promise.resolve(false)
    ));
    stubFetchWithCapability(vi.fn(async () => jsonResponse(204)));

    const result = switchWebOrganization('org-acme');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'We could not confirm the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(instance.updateToken).toHaveBeenCalledWith(-1);
  });

  it('does not report success when the refreshed claim names another organization', async () => {
    signedIn();
    instance.updateToken.mockImplementation(async () => true);
    stubFetchWithCapability(vi.fn(async () => jsonResponse(204)));

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'We could not confirm the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(instance.updateToken).toHaveBeenCalledWith(-1);
  });

  it('reloads without clearing tenant state when token preflight times out', async () => {
    vi.useFakeTimers();
    signedIn();
    instance.updateToken.mockImplementation(() => new Promise<boolean>(() => {}));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = switchWebOrganization('org-acme');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'We could not prepare the organization change. Reload to continue.',
      reloadRequired: true,
      clearTenantState: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses before the PUT when the cross-tab marker cannot be persisted', async () => {
    signedIn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('Storage denied'); }),
      removeItem: vi.fn(),
    });
    const fetchMock = vi.fn();
    stubFetchWithCapability(fetchMock);

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'We could not safely change organization in this browser. Nothing changed.',
      reloadRequired: false,
      clearTenantState: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('refuses before the PUT when exclusive browser locks are unavailable', async () => {
    signedIn();
    vi.stubGlobal('navigator', {});
    const fetchMock = vi.fn();
    stubFetchWithCapability(fetchMock);

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'We could not safely change organization in this browser. Nothing changed.',
      reloadRequired: false,
      clearTenantState: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('fails before the request when the target is blank', async () => {
    signedIn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(switchWebOrganization('  ')).resolves.toEqual({
      ok: false,
      reason: 'Choose an organization to continue.',
      reloadRequired: false,
      clearTenantState: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails before the request when there is no authenticated bearer token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(switchWebOrganization('org-acme')).resolves.toEqual({
      ok: false,
      reason: 'Sign in to change organization.',
      reloadRequired: false,
      clearTenantState: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
