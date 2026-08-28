import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// minds-auth transitively imports server-process, which statically imports
// `electron`. In the node test env `electron` resolves to a path string, so
// stub it before importing the module under test.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock('./token-store', () => ({
  saveTokens: vi.fn(),
  getRefreshToken: vi.fn(),
  clearTokens: vi.fn(),
  getTokenStoreVersion: vi.fn(() => 0),
  getAccessToken: vi.fn(),
  isAccessTokenExpired: vi.fn(() => false),
}));
vi.mock('./server-process', () => ({
  stopServer: vi.fn(),
  startServer: vi.fn(),
  isServerRunning: vi.fn(() => true),
  isServerStarting: vi.fn(() => false),
  getServerPort: vi.fn(() => 8765),
}));
vi.mock('./installer', () => ({
  checkInstallStatus: vi.fn(async () => ({ antonInstalled: false })),
}));
vi.mock('./installation-id', () => ({
  getInstallationId: vi.fn(() => 'deadbeef00000000'),
}));
// Hoisted, because the factory below now runs during import rather than lazily:
// minds-auth reaches keychain-fallback through minds-credential, and that module
// calls coworkHome() at module scope. A plain `const` further down the file is
// still in its temporal dead zone by then, and the whole file fails to load.
const TEST_HOME = vi.hoisted(() => '/tmp/minds-auth-orgs-test');

// Partial mock: only the path functions are pinned to the test dir, because a
// full-replacement factory breaks at load whenever cowork-home gains an export
// a transitive import reads at module scope.
vi.mock('./cowork-home', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cowork-home')>()),
  coworkHome: () => TEST_HOME,
  coworkEnvPath: () => `${TEST_HOME}/.env`,
  coworkStatePath: () => `${TEST_HOME}/state.json`,
}));
vi.mock('./server-auth', () => ({
  authHeader: () => ({ Authorization: 'Bearer owner-token' }),
}));

import * as fs from 'fs';
import { getAccessToken, getRefreshToken, isAccessTokenExpired, saveTokens } from './token-store';
import { ensureActiveOrg, listMindsOrgs, switchMindsOrg } from './minds-auth';


const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const makeJwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;

const USER = 'user-1';
const PERSONAL = { id: 'org-personal', name: `personal_${USER}`, displayName: "dana@acme.example's organization" };
const ACME = { id: 'org-acme', name: 'acme.example', displayName: 'acme.example' };
const BETA = { id: 'org-beta', name: 'beta.example', displayName: 'Beta Labs' };

const tokenFor = (org: { id: string; name: string }) =>
  makeJwt({ sub: USER, activate_organization: { id: org.id, name: org.name } });

const ENTITLED = {
  permissions: { agents: { use: true }, api_keys: { create: true } },
  allocations: { deploy_agents: 1 },
};
// Entitled to use agents, but not to mint a key — what a member of a shared
// organization looks like, and what trips the personal-org fallback.

/** The organization an `Authorization: Bearer <jwt>` header names. */
const orgOfToken = (header: string) =>
  JSON.parse(Buffer.from(header.replace('Bearer ', '').split('.')[1], 'base64url').toString())
    .activate_organization.id;

interface RoutedCall { method: string; url: string; body?: string; auth?: string }
type Route = {
  method: string;
  match: string;
  reply: (call: RoutedCall) => { status: number; body: unknown };
};

// URL-routed fetch stub, same shape as the renewal tests use. Unmatched
// requests get a 500, which every org helper here swallows into "nothing
// found" — so a test only stubs the endpoints it is actually about.
function installRoutedFetch(routes: Route[]): RoutedCall[] {
  const calls: RoutedCall[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call: RoutedCall = {
      method: (init?.method || 'GET').toUpperCase(),
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : undefined,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    };
    calls.push(call);
    for (const route of routes) {
      if (route.method === call.method && call.url.includes(route.match)) {
        const { status, body } = route.reply(call);
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
    }
    return { ok: false, status: 500, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return calls;
}

/** Keycloak reads plus a token exchange that lands in `landsIn`. */
function keycloakRoutes(
  memberships: Array<{ id: string; name: string; displayName?: string }>,
  landsIn: () => { id: string; name: string },
  opts: { switchOk?: boolean; refreshOk?: boolean } = {},
): Route[] {
  const { switchOk = true, refreshOk = true } = opts;
  return [
    { method: 'GET', match: '/orgs?', reply: () => ({ status: 200, body: memberships }) },
    { method: 'PUT', match: 'users/switch-organization', reply: () => ({ status: switchOk ? 204 : 403, body: {} }) },
    {
      method: 'POST',
      match: 'openid-connect/token',
      reply: () => refreshOk
        ? { status: 200, body: { access_token: tokenFor(landsIn()), expires_in: 300, refresh_token: 'rt-2' } }
        : { status: 500, body: {} },
    },
  ];
}

// `handOverOk: false` is the sidecar refusing the credential. Nothing mints any
// more, so this is the only local write a switch makes.
const sidecarRoutes = (opts: { handOverOk?: boolean } = {}): Route[] => [
  { method: 'GET', match: '/authenticate/', reply: () => ({ status: 200, body: { entitlements: ENTITLED } }) },
  {
    method: 'PUT',
    match: '/runtime-credential/minds',
    reply: () => ({ status: opts.handOverOk === false ? 500 : 200, body: { ok: true } }),
  },
];

describe('choosing the organization the presented token names', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_HOME, { recursive: true });
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (isAccessTokenExpired as Mock).mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('moves a personal-active token onto the company organization', async () => {
    // The reported case: signing in with Personal active put the key where the
    // company could neither pay for it nor revoke it.
    let landed = PERSONAL;
    const calls = installRoutedFetch(
      keycloakRoutes([PERSONAL, ACME], () => landed).map((route) =>
        route.method === 'PUT'
          ? { ...route, reply: (call: RoutedCall) => { landed = JSON.parse(call.body!).id === ACME.id ? ACME : PERSONAL; return { status: 204, body: {} }; } }
          : route),
    );

    const result = await ensureActiveOrg(tokenFor(PERSONAL));

    const switched = calls.find((c) => c.method === 'PUT' && c.url.includes('switch-organization'));
    expect(JSON.parse(switched!.body!)).toEqual({ id: ACME.id });
    expect(result.activeOrgId).toBe(ACME.id);
    expect(result.orgs?.map((o) => o.id)).toEqual([ACME.id, PERSONAL.id]);
  });

  it('makes no switch and no refresh for an account with one organization', async () => {
    // The path every existing user takes. It must cost exactly what it cost
    // before: the ranking is an improvement on where a key lands, not a tax on
    // everyone who has nowhere else to put one.
    const calls = installRoutedFetch(keycloakRoutes([PERSONAL], () => PERSONAL));

    const result = await ensureActiveOrg(tokenFor(PERSONAL));

    expect(calls.filter((c) => c.url.includes('switch-organization'))).toHaveLength(0);
    expect(calls.filter((c) => c.url.includes('openid-connect/token'))).toHaveLength(0);
    expect(result.activeOrgId).toBe(PERSONAL.id);
  });

  it('makes no switch when the company organization is already active', async () => {
    const calls = installRoutedFetch(keycloakRoutes([PERSONAL, ACME], () => ACME));

    const result = await ensureActiveOrg(tokenFor(ACME));

    expect(calls.filter((c) => c.url.includes('switch-organization'))).toHaveLength(0);
    expect(result.activeOrgId).toBe(ACME.id);
  });

  it('honours a pick the person made, over the ranking', async () => {
    // Someone who deliberately moved to Personal must not be dragged back to
    // the company organization on the next relaunch.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: PERSONAL.id } } }),
    );
    const calls = installRoutedFetch(keycloakRoutes([PERSONAL, ACME], () => PERSONAL));

    const result = await ensureActiveOrg(tokenFor(PERSONAL));

    expect(calls.filter((c) => c.url.includes('switch-organization'))).toHaveLength(0);
    expect(result.activeOrgId).toBe(PERSONAL.id);
  });

  it('records an organization named by onboarding as this install\'s pick', async () => {
    let landed = PERSONAL;
    installRoutedFetch(
      keycloakRoutes([PERSONAL, ACME, BETA], () => landed).map((route) =>
        route.method === 'PUT'
          ? { ...route, reply: (call: RoutedCall) => { const id = JSON.parse(call.body!).id; landed = [PERSONAL, ACME, BETA].find((o) => o.id === id)!; return { status: 204, body: {} }; } }
          : route),
    );

    await ensureActiveOrg(tokenFor(PERSONAL), { preferOrgId: BETA.id });

    const stored = JSON.parse(fs.readFileSync(`${TEST_HOME}/state.json`, 'utf-8'));
    expect(stored.preferences.mindsOrganization).toEqual({ sub: USER, orgId: BETA.id });
  });

  it('ignores an organization named by onboarding that the person does not belong to', async () => {
    // The membership list decides, not the caller. Nothing anywhere takes an
    // organization id from the renderer and puts it on a key request.
    installRoutedFetch(keycloakRoutes([PERSONAL], () => PERSONAL));

    const result = await ensureActiveOrg(tokenFor(PERSONAL), { preferOrgId: 'org-not-mine' });

    expect(result.activeOrgId).toBe(PERSONAL.id);
    expect(fs.existsSync(`${TEST_HOME}/state.json`)).toBe(false);
  });

  it('keeps a usable token when Keycloak refuses every switch', async () => {
    // Ranking is an improvement on where the key lands, never a precondition
    // for getting one. A refusal must not sign anybody out.
    installRoutedFetch(keycloakRoutes([PERSONAL, ACME], () => PERSONAL, { switchOk: false }));

    const result = await ensureActiveOrg(tokenFor(PERSONAL));

    expect(result.token).toBe(tokenFor(PERSONAL));
    expect(result.activeOrgId).toBe(PERSONAL.id);
  });
});

describe('listMindsOrgs', () => {
  beforeEach(() => {
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (isAccessTokenExpired as Mock).mockReturnValue(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it('answers company organizations first, with the active one named', async () => {
    (getAccessToken as Mock).mockReturnValue(tokenFor(PERSONAL));
    installRoutedFetch(keycloakRoutes([PERSONAL, ACME], () => PERSONAL));

    const result = await listMindsOrgs();

    expect(result.orgs.map((o) => o.displayName)).toEqual(['acme.example', "dana@acme.example's organization"]);
    expect(result.activeOrgId).toBe(PERSONAL.id);
  });

  it('answers nothing when signed out, rather than throwing at the caller', async () => {
    (getAccessToken as Mock).mockReturnValue(null);
    (getRefreshToken as Mock).mockReturnValue(null);
    expect(await listMindsOrgs()).toEqual({ orgs: [], activeOrgId: null });
  });
});

describe('switchMindsOrg', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_HOME, { recursive: true });
    fs.writeFileSync(`${TEST_HOME}/.env`, 'ANTON_MINDS_API_KEY=mdb_old\n');
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (isAccessTokenExpired as Mock).mockReturnValue(false);
    (getAccessToken as Mock).mockReturnValue(tokenFor(PERSONAL));
    // The store follows the exchange, the way refreshAfterOrgSwitch's
    // saveTokens does in the real flow.
    (saveTokens as Mock).mockImplementation((token: string) => {
      (getAccessToken as Mock).mockReturnValue(token);
    });
  });
  afterEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function routesFor(landsInRef: { current: { id: string; name: string } }, opts: { handOverOk?: boolean } = {}) {
    const keycloak = keycloakRoutes([PERSONAL, ACME], () => landsInRef.current).map((route) =>
      route.method === 'PUT' && route.match.includes('switch-organization')
        ? {
          ...route,
          reply: (call: RoutedCall) => {
            const id = JSON.parse(call.body!).id;
            landsInRef.current = [PERSONAL, ACME].find((o) => o.id === id)!;
            return { status: 204, body: {} };
          },
        }
        : route);
    return [...sidecarRoutes(opts), ...keycloak];
  }

  it('switches, hands the fresh token over, and remembers the pick', async () => {
    const landsIn = { current: PERSONAL };
    const calls = installRoutedFetch(routesFor(landsIn));

    const result = await switchMindsOrg(ACME.id);

    expect(result.ok).toBe(true);
    expect(result.activeOrgId).toBe(ACME.id);
    // The credential the sidecar presents has to be the re-rolled token, or
    // turns keep billing the organization the person just left while the menu
    // says otherwise. Nothing is minted and nothing is stored.
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/runtime-credential/minds'))!;
    expect(orgOfToken(`Bearer ${JSON.parse(put.body!).value}`)).toBe(ACME.id);
    expect(put.auth).toBe('Bearer owner-token');
    expect(calls.filter((c) => c.url.includes('/api-keys/'))).toHaveLength(0);
    // And the pick is remembered, so the ranking does not undo it next launch.
    const stored = JSON.parse(fs.readFileSync(`${TEST_HOME}/state.json`, 'utf-8'));
    expect(stored.preferences.mindsOrganization).toEqual({ sub: USER, orgId: ACME.id });
  });

  it('refuses an organization the person does not belong to', async () => {
    const landsIn = { current: PERSONAL };
    const calls = installRoutedFetch(routesFor(landsIn));

    const result = await switchMindsOrg('org-not-mine');

    expect(result.ok).toBe(false);
    expect(result.activeOrgId).toBe(PERSONAL.id);
    expect(calls.filter((c) => c.url.includes('switch-organization'))).toHaveLength(0);
  });

  it('leaves the previous organization active when Keycloak refuses the switch', async () => {
    const landsIn = { current: PERSONAL };
    const calls = installRoutedFetch(
      routesFor(landsIn).map((route) =>
        route.match.includes('switch-organization') ? { ...route, reply: () => ({ status: 403, body: {} }) } : route),
    );

    const result = await switchMindsOrg(ACME.id);

    expect(result.ok).toBe(false);
    expect(result.activeOrgId).toBe(PERSONAL.id);
    expect(result.error).toMatch(/Nothing changed/);
    // The sidecar was never handed a token naming an organization the session
    // did not actually move to.
    expect(calls.filter((c) => c.url.includes('/runtime-credential/minds'))).toHaveLength(0);
  });

  it('puts the organization back when the sidecar will not take the credential', async () => {
    const landsIn = { current: PERSONAL };
    const calls = installRoutedFetch(routesFor(landsIn, { handOverOk: false }));

    const result = await switchMindsOrg(ACME.id);

    expect(result.ok).toBe(false);
    expect(result.activeOrgId).toBe(PERSONAL.id);
    // Reporting success here would leave the console naming one organization
    // and the sidecar spending another's credits.
    const switches = calls.filter((c) => c.url.includes('switch-organization')).map((c) => JSON.parse(c.body!).id);
    expect(switches).toEqual([ACME.id, PERSONAL.id]);
    // The pick is only remembered once the credential lands.
    expect(fs.existsSync(`${TEST_HOME}/state.json`)).toBe(false);
  });

  it('switches to the organization that was asked for, not the stored one', async () => {
    // The regression this guards: a switch AWAY from the stored pick used to be
    // silently undone, because the org was re-derived from that stored pick
    // rather than taken from the caller. Only the personal-to-first-company
    // direction happened to agree with the ranking.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: ACME.id } } }),
    );
    (getAccessToken as Mock).mockReturnValue(tokenFor(ACME));
    const landsIn = { current: ACME };
    const calls = installRoutedFetch(routesFor(landsIn));

    const result = await switchMindsOrg(PERSONAL.id);

    expect(result.ok).toBe(true);
    expect(result.activeOrgId).toBe(PERSONAL.id);
    // One switch, to where the person asked. No second one putting it back.
    const switches = calls.filter((c) => c.url.includes('switch-organization')).map((c) => JSON.parse(c.body!).id);
    expect(switches).toEqual([PERSONAL.id]);
    // And the token handed over names that organization.
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/runtime-credential/minds'))!;
    expect(orgOfToken(`Bearer ${JSON.parse(put.body!).value}`)).toBe(PERSONAL.id);
  });

  it('refuses a second switch while one is still running', async () => {
    // Two switches interleaving would race each other through the token store
    // and the hand-over, and the sidecar would end up on whichever token landed
    // last rather than the organization the menu reports.
    const landsIn = { current: PERSONAL };
    installRoutedFetch(routesFor(landsIn));

    const [first, second] = await Promise.all([
      switchMindsOrg(ACME.id),
      switchMindsOrg(ACME.id),
    ]);

    const [done, refused] = first.ok ? [first, second] : [second, first];
    expect(done.ok).toBe(true);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/already running/);
  });
});
