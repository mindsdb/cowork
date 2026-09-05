import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Stub Electron before minds-auth's transitive imports; Node otherwise receives its executable path
// string.
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
// Hoist the holder: minds-credential reaches keychain-fallback, which calls coworkHome during
// import.
const TEST_HOME = vi.hoisted(() => '/tmp/minds-auth-orgs-test');

// Mock only path functions so new cowork-home exports used by transitive imports remain available.
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
import { ensureActiveOrg, listMindsOrgs, selectEntitledOrg, switchMindsOrg } from './minds-auth';


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
// An unentitled organization returns a valid 200; transport/auth failures must stop selection
// rather than trigger fallback.
const UNENTITLED = {
  permissions: { agents: { use: false }, api_keys: { create: false } },
  allocations: { deploy_agents: 0 },
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

// Route fetch stubs by URL; unstubbed endpoints return 500 and exercise the helpers' unavailable
// fallback.
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
    const calls = installRoutedFetch([
      ...sidecarRoutes(),
      ...keycloakRoutes([PERSONAL, ACME], () => landed).map((route) =>
        route.method === 'PUT'
          ? { ...route, reply: (call: RoutedCall) => { landed = JSON.parse(call.body!).id === ACME.id ? ACME : PERSONAL; return { status: 204, body: {} }; } }
          : route),
    ]);

    const result = await ensureActiveOrg(tokenFor(PERSONAL));

    const switched = calls.find((c) => c.method === 'PUT' && c.url.includes('switch-organization'));
    expect(JSON.parse(switched!.body!)).toEqual({ id: ACME.id });
    expect(result.activeOrgId).toBe(ACME.id);
    expect(result.orgs?.map((o) => o.id)).toEqual([ACME.id, PERSONAL.id]);
  });

  it('makes no switch and no refresh for an account with one organization', async () => {
    // A single-organization account must not pay additional requests for ranking.
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

  it('honours a stored pick over the ranking', async () => {
    // A deliberate stored choice wins over company-first ranking; selectEntitledOrg tests
    // separately cover entitlement fallback.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: PERSONAL.id, chosenByUser: true } } }),
    );
    const calls = installRoutedFetch(keycloakRoutes([PERSONAL, ACME], () => PERSONAL));

    const result = await ensureActiveOrg(tokenFor(PERSONAL));

    expect(calls.filter((c) => c.url.includes('switch-organization'))).toHaveLength(0);
    expect(result.activeOrgId).toBe(PERSONAL.id);
  });

  it('persists nothing — making an organization active is not deciding to keep it', async () => {
    // Persist only at selectEntitledOrg, where the session's final organization is known.
    let landed = PERSONAL;
    installRoutedFetch([
      ...sidecarRoutes(),
      ...keycloakRoutes([PERSONAL, ACME, BETA], () => landed).map((route) =>
        route.method === 'PUT'
          ? { ...route, reply: (call: RoutedCall) => { const id = JSON.parse(call.body!).id; landed = [PERSONAL, ACME, BETA].find((o) => o.id === id)!; return { status: 204, body: {} }; } }
          : route),
    ]);

    await ensureActiveOrg(tokenFor(PERSONAL), { preferOrgId: BETA.id });

    expect(fs.existsSync(`${TEST_HOME}/state.json`)).toBe(false);
  });

  it('ignores an organization named by onboarding that the person does not belong to', async () => {
    // The membership list decides, not the caller. Nothing anywhere takes an
    // organization id from the renderer and puts it on a key request.
    installRoutedFetch(keycloakRoutes([PERSONAL], () => PERSONAL));

    const result = await ensureActiveOrg(tokenFor(PERSONAL), { preferOrgId: 'org-not-mine' });

    expect(result.activeOrgId).toBe(PERSONAL.id);
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
    // Push the re-rolled token so turns use the organization the menu reports, without minting or
    // storing a new key.
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/runtime-credential/minds'))!;
    expect(orgOfToken(`Bearer ${JSON.parse(put.body!).value}`)).toBe(ACME.id);
    expect(put.auth).toBe('Bearer owner-token');
    expect(calls.filter((c) => c.url.includes('/api-keys/'))).toHaveLength(0);
    const stored = JSON.parse(fs.readFileSync(`${TEST_HOME}/state.json`, 'utf-8'));
    // An account-menu switch is a person acting, so it is recorded as chosen —
    // which is what stops the entitlement hunt revising it later (ENG-2199).
    expect(stored.preferences.mindsOrganization).toEqual({ sub: USER, orgId: ACME.id, chosenByUser: true });
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
    // Switching away from a stored pick must use the caller's requested organization rather than
    // re-derive the stored one.
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
    const switches = calls.filter((c) => c.url.includes('switch-organization')).map((c) => JSON.parse(c.body!).id);
    expect(switches).toEqual([PERSONAL.id]);
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/runtime-credential/minds'))!;
    expect(orgOfToken(`Bearer ${JSON.parse(put.body!).value}`)).toBe(PERSONAL.id);
  });

  it('refuses a second switch while one is still running', async () => {
    // Serialize switches so token-store and sidecar handoffs cannot disagree about the active
    // organization.
    const landsIn = { current: PERSONAL };
    installRoutedFetch(routesFor(landsIn));

    const [first, second] = await Promise.all([
      switchMindsOrg(ACME.id),
      switchMindsOrg(ACME.id),
    ]);

    const [done, refused] = first.ok ? [first, second] : [second, first];
    expect(done.ok).toBe(true);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/still settling which organization/i);
  });
});

// Test selectEntitledOrg itself: ensureActiveOrg can honor a pick that the later entitlement
// fallback would still override.
describe('selectEntitledOrg — who decides which organization pays', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_HOME, { recursive: true });
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (isAccessTokenExpired as Mock).mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /**
   * Answer entitlement per organization; the earlier globally entitled stub cannot reach this
   * fallback branch.
   */
  function entitlementRoutes(
    memberships: Array<{ id: string; name: string; displayName?: string }>,
    startIn: { id: string; name: string },
    entitled: string[],
    opts: {
      refuse?: string[];
      orgsStatus?: number;
      /** Every refresh from the Nth on fails transiently. */
      failRefreshFrom?: number;
      /** Only the Nth refresh fails, so a retry can succeed. */
      failRefreshOnce?: number;
      /**
       * Refuse only the restoration trip, after ranking and the hunt have already moved the
       * session.
       */
      refuseReturn?: boolean;
    } = {},
  ) {
    let active = startIn;
    let tokenOrg = startIn;
    let refreshes = 0;
    // The hunt starts where ranking leaves the session, not necessarily at the token's original
    // organization.
    let startedFrom = startIn.id;
    let sawFirstAuth = false;
    const calls = installRoutedFetch([
      // Membership failure and empty membership both become []; explicitly exercise the failure
      // source.
      {
        method: 'GET',
        match: '/orgs',
        reply: () => ({ status: opts.orgsStatus ?? 200, body: (opts.orgsStatus ?? 200) === 200 ? memberships : {} }),
      },
      {
        method: 'PUT',
        match: 'users/switch-organization',
        reply: (call) => {
          const id = JSON.parse(call.body!).id;
          // `refuse` is Keycloak saying no to a switch the app asked for — a
          // real answer, distinct from an organization the person is not in.
          if (opts.refuse?.includes(id)) return { status: 403, body: {} };
          if (opts.refuseReturn && sawFirstAuth && id === startedFrom && active.id !== startedFrom) {
            return { status: 403, body: {} };
          }
          const found = memberships.find((o) => o.id === id);
          if (found) active = found;
          return { status: found ? 204 : 403, body: {} };
        },
      },
      {
        method: 'POST',
        match: 'openid-connect/token',
        reply: () => {
          refreshes += 1;
          // A 503 preserves tokens, so the store still names the organization from the previous
          // successful refresh.
          if (opts.failRefreshFrom && refreshes >= opts.failRefreshFrom) {
            return { status: 503, body: {} };
          }
          if (opts.failRefreshOnce && refreshes === opts.failRefreshOnce) {
            return { status: 503, body: {} };
          }
          tokenOrg = active;
          return { status: 200, body: { access_token: tokenFor(active), expires_in: 300, refresh_token: 'rt-2' } };
        },
      },
      {
        method: 'GET',
        match: '/authenticate/',
        reply: (call) => {
          if (!sawFirstAuth) { startedFrom = orgOfToken(call.auth!); sawFirstAuth = true; }
          return {
            status: 200,
            body: { entitlements: entitled.includes(orgOfToken(call.auth!)) ? ENTITLED : UNENTITLED },
          };
        },
      },
    ]);
    // main reads the settled token back out of the store, so the store has to
    // follow the switches the same way the real token-store does.
    (getAccessToken as Mock).mockImplementation(() => tokenFor(tokenOrg));
    return {
      calls,
      switches: () => calls.filter((c) => c.url.includes('switch-organization')).map((c) => JSON.parse(c.body!).id),
      activeOrg: () => active,
      tokenOrg: () => tokenOrg,
      /** Where the hunt began, which is what a restore has to reach. */
      startedIn: () => startedFrom,
    };
  }

  const storedPick = () =>
    JSON.parse(fs.readFileSync(`${TEST_HOME}/state.json`, 'utf-8')).preferences.mindsOrganization;
  /** The raw row, or null when nothing has been written. */
  const storedRow = () => {
    try { return storedPick(); } catch { return null; }
  };
  const seedRow = (sub: string, orgId: string, chosenByUser: boolean) => fs.writeFileSync(
    `${TEST_HOME}/state.json`,
    JSON.stringify({ preferences: { mindsOrganization: { sub, orgId, chosenByUser } } }),
  );

  it('honours an organization the person picked, even though it cannot pay', async () => {
    // Honor a deliberate unentitled choice; insufficient credits belong to the first turn's top-up
    // flow, not sign-in relocation.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [ACME, BETA].map((o) => o.id));

    const result = await selectEntitledOrg(tokenFor(PERSONAL), {
      preferOrgId: PERSONAL.id,
      chosenByUser: true,
    });

    expect(result.organization?.id).toBe(PERSONAL.id);
    expect(net.switches()).toEqual([]);
    expect(storedPick()).toEqual({ sub: USER, orgId: PERSONAL.id, chosenByUser: true });
  });

  it('still moves an organization nobody chose to one that can pay', async () => {
    // Without a deliberate choice, retain fallback to an organization that can pay.
    const net = entitlementRoutes([PERSONAL, ACME], PERSONAL, [ACME.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.organization?.id).toBe(ACME.id);
    // Recorded nowhere. Where a call happened to run is not evidence about what
    // the person wants, and `state.json` has one slot to overwrite with it.
    expect(storedRow()).toBeNull();
    expect(net.activeOrg().id).toBe(ACME.id);
  });

  it('puts the session back where it started when nothing can pay', async () => {
    // Restore the hunt's starting organization after exhaustion; ranking's earlier move is not part
    // of the rollback.
    const net = entitlementRoutes([PERSONAL, ACME], PERSONAL, []);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(net.switches().at(-1)).toBe(ACME.id);
    expect(net.activeOrg().id).toBe(ACME.id);
    expect(result.organization?.id).toBe(ACME.id);
    expect(storedRow()).toBeNull();
  });

  it('does not re-open a choice the person made on an earlier run', async () => {
    // Reconnect passes no id, so stored provenance must preserve deliberate choices through session
    // re-establishment.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: PERSONAL.id, chosenByUser: true } } }),
    );
    const net = entitlementRoutes([PERSONAL, ACME], PERSONAL, [ACME.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(net.switches()).toEqual([]);
    expect(result.organization?.id).toBe(PERSONAL.id);
    expect(storedPick()).toEqual({ sub: USER, orgId: PERSONAL.id, chosenByUser: true });
  });

  it('treats an organization it landed on itself as still open to revision', async () => {
    // Seed an automatic stored landing manually: current writers do not create chosenByUser=false.
    // Guard against future writes turning automatic placement into a permanent preference.
    seedRow(USER, ACME.id, false);
    entitlementRoutes([PERSONAL, ACME, BETA], ACME, [BETA.id]);

    const result = await selectEntitledOrg(tokenFor(ACME));

    expect(result.organization?.id).toBe(BETA.id);
    expect(storedRow()).toEqual({ sub: USER, orgId: ACME.id, chosenByUser: false });
  });

  it('does not treat a fallen-back-to organization as the person\'s choice', async () => {
    // A requested choice is authoritative only if the switch landed; refusal must not label an
    // accidental fallback as user-chosen.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [PERSONAL.id], {
      refuse: [BETA.id],
    });

    const result = await selectEntitledOrg(tokenFor(PERSONAL), {
      preferOrgId: BETA.id,
      chosenByUser: true,
    });

    expect(net.switches()).toContain(BETA.id);
    // The requested switch was refused; run entitlement fallback without recording its result as
    // the user's choice.
    expect(result.organization?.id).toBe(PERSONAL.id);
    expect(storedRow()).toBeNull();
  });

  it('does not erase a standing choice when the membership read fails', async () => {
    // Reconnect during a membership-read failure must not overwrite the only durable record of a
    // deliberate pick.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: BETA.id, chosenByUser: true } } }),
    );
    entitlementRoutes([PERSONAL, ACME, BETA], ACME, [ACME.id], { orgsStatus: 503 });

    const result = await selectEntitledOrg(tokenFor(ACME));

    // Where this call ran is not evidence about what the person wants.
    expect(storedPick()).toEqual({ sub: USER, orgId: BETA.id, chosenByUser: true });
    // The live session honestly reports where it is, which is not their choice.
    expect(result.organization?.id).toBe(ACME.id);
  });

  it('recovers the choice on the next read that can see it', async () => {
    // After membership recovers, the preserved preference must become usable again.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: BETA.id, chosenByUser: true } } }),
    );
    entitlementRoutes([PERSONAL, ACME, BETA], ACME, [ACME.id], { orgsStatus: 503 });
    await selectEntitledOrg(tokenFor(ACME));

    entitlementRoutes([PERSONAL, ACME, BETA], ACME, [ACME.id]);
    const healthy = await selectEntitledOrg(tokenFor(ACME));

    expect(healthy.organization?.id).toBe(BETA.id);
    expect(storedPick()).toEqual({ sub: USER, orgId: BETA.id, chosenByUser: true });
  });

  it('stops honouring a choice once the membership is really gone', async () => {
    // An obsolete membership must not permanently pin the install.
    // The stored identity must match the hunt's actual start before it can suppress fallback.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: BETA.id, chosenByUser: true } } }),
    );
    entitlementRoutes([PERSONAL, ACME], PERSONAL, [PERSONAL.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.organization?.id).toBe(PERSONAL.id);
  });

  it('fails rather than reporting success when the restore cannot be confirmed', async () => {
    // A landed restore with failed refresh leaves the active token unconfirmed; surface a retryable
    // error rather than report successful relocation.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [], { failRefreshFrom: 4 });

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.token).toBeUndefined();
    expect(result.error).toMatch(/could not put this computer back/i);
    expect(fs.existsSync(`${TEST_HOME}/state.json`)).toBe(false);
    // Count the final two restore attempts separately from ranking's earlier switch to the same
    // organization.
    expect(net.switches().slice(-2)).toEqual([net.startedIn(), net.startedIn()]);
  });

  it('fails when Keycloak refuses to put the session back', async () => {
    // A refused restore differs from a failed token refresh: the session never moved back at all.
    // Do not report success merely because the old token still names the starting organization.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [], { refuseReturn: true });

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.token).toBeUndefined();
    expect(result.error).toMatch(/could not put this computer back/i);
    expect(fs.existsSync(`${TEST_HOME}/state.json`)).toBe(false);
    // It really did leave, and really did not get back.
    expect(net.activeOrg().id).not.toBe(net.startedIn());
    expect(net.switches().slice(-2)).toEqual([net.startedIn(), net.startedIn()]);
  });

  it('retries a restore once and succeeds when the second attempt confirms', async () => {
    // Retry transient refresh failure during restore rather than unnecessarily failing sign-in.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [], { failRefreshOnce: 4 });

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.error).toBeUndefined();
    expect(result.organization?.id).toBe(net.startedIn());
  });

  it('does not let an organization it landed on outrank the ranking later', async () => {
    // Seed automatic provenance manually to ensure a later company membership can still win
    // ranking.
    // An automatic Personal landing must not become a durable user preference.
    seedRow(USER, PERSONAL.id, false);
    entitlementRoutes([PERSONAL, ACME], PERSONAL, [PERSONAL.id, ACME.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.organization?.id).toBe(ACME.id);
    expect(storedRow()).toEqual({ sub: USER, orgId: PERSONAL.id, chosenByUser: false });
  });

  it("leaves another account's pick alone on an ordinary sign-in", async () => {
    // state.json has one preference slot; account B's automatic landing must not erase account A's
    // deliberate choice.
    const OTHER = 'user-other';
    seedRow(OTHER, BETA.id, true);
    entitlementRoutes([PERSONAL, ACME], ACME, [ACME.id]);

    await selectEntitledOrg(tokenFor(ACME));

    expect(storedRow()).toEqual({ sub: OTHER, orgId: BETA.id, chosenByUser: true });
  });

  it('does not switch at all when the hunt had nowhere to go', async () => {
    // If the only candidate is already active, no move occurred and no restoration requests are
    // needed.
    const net = entitlementRoutes([PERSONAL], PERSONAL, []);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(net.switches()).toEqual([]);
    expect(result.organization?.id).toBe(PERSONAL.id);
  });

  it('honours a pick the session has to switch into, and records it', async () => {
    // Exercise a deliberate pick that requires and completes a real switch; other cases start there
    // or refuse the switch.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [ACME.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL), {
      preferOrgId: BETA.id,
      chosenByUser: true,
    });

    expect(net.switches()).toEqual([BETA.id]);
    expect(net.activeOrg().id).toBe(BETA.id);
    // Beta cannot pay and Acme can, so this is exactly where the hunt used to
    // drag them away.
    expect(result.organization?.id).toBe(BETA.id);
    expect(storedRow()).toEqual({ sub: USER, orgId: BETA.id, chosenByUser: true });
  });

  it('waits for an account-menu switch instead of refusing', async () => {
    // Wait for concurrent organization changes; an interleaved hunt restore could undo a successful
    // user switch.
    // Refusing would trigger ReconnectCard's full browser login despite a valid session.
    let releaseSwitch: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseSwitch = resolve; });
    const members = [PERSONAL, ACME];
    let active = PERSONAL;
    let switchReached = false;
    // Record every request: a pending promise alone cannot distinguish lock waiting from reaching
    // the shared gate.
    const seen: Array<{ url: string; auth?: string }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      const method = (init?.method || 'GET').toUpperCase();
      const reply = (status: number, body: unknown) =>
        ({ ok: status >= 200 && status < 400, status, json: async () => body });
      if (url.includes('/orgs')) return reply(200, members);
      if (method === 'PUT' && url.includes('users/switch-organization')) {
        switchReached = true;
        await gate;                       // hold the switch open
        const id = JSON.parse(init!.body as string).id;
        const found = members.find((o) => o.id === id);
        if (found) active = found;
        return reply(found ? 204 : 403, {});
      }
      if (url.includes('openid-connect/token')) {
        return reply(200, { access_token: tokenFor(active), expires_in: 300, refresh_token: 'rt-2' });
      }
      if (url.includes('/authenticate/')) return reply(200, { entitlements: ENTITLED });
      if (url.includes('/runtime-credential/minds')) return reply(200, { ok: true });
      return reply(500, {});
    }) as unknown as typeof fetch;
    (getAccessToken as Mock).mockImplementation(() => tokenFor(active));

    const switching = switchMindsOrg(ACME.id);
    for (let i = 0; i < 50 && !switchReached; i++) await Promise.resolve();
    expect(switchReached).toBe(true);

    const before = seen.length;
    let selectSettled = false;
    const selecting = selectEntitledOrg(tokenFor(PERSONAL))
      .then((r) => { selectSettled = true; return r; })
      .catch((e) => { selectSettled = true; throw e; });
    try {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(selectSettled).toBe(false);
      // No request should start while queued on the lock; an unlocked selection would already reach
      // /orgs.
      expect(seen.slice(before)).toEqual([]);
    } finally {
      // Release even on failure, or the lock outlives this test and every
      // later one waits on a promise that never settles.
      releaseSwitch();
    }

    const [switched, selected] = await Promise.all([switching, selecting]);

    expect(switched.ok).toBe(true);
    expect(selected.error).toBeUndefined();
    expect(selected.token).toBeTruthy();
    expect(seen.length).toBeGreaterThan(before);
    // After waiting, use the switch's current token for membership lookup, not a stale captured
    // claim.
    // Other authenticated calls here use the sidecar owner token.
    const membershipRead = seen.slice(before).find((call) => call.url.includes('/orgs'));
    expect(membershipRead?.auth).toBeTruthy();
    expect(orgOfToken(membershipRead!.auth!)).toBe(ACME.id);
  });

  it('never records an organization the person does not belong to', async () => {
    // Validate renderer-supplied organization membership before persisting its id.
    entitlementRoutes([PERSONAL], PERSONAL, []);

    const result = await selectEntitledOrg(tokenFor(PERSONAL), {
      preferOrgId: 'org-not-mine',
      chosenByUser: true,
    });

    expect(result.organization?.id).toBe(PERSONAL.id);
    // The id failed the membership check, so it is not a pick at all — and an
    // organization nobody chose is never written.
    expect(storedRow()).toBeNull();
  });
});
