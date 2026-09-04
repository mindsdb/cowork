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
// What an organization with no credits answers: a well-formed 200 that simply
// cannot run turns. Distinct from a transport or auth failure, which
// `selectEntitledOrg` treats as a hard stop rather than a reason to look
// elsewhere.
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

  it('honours a stored pick over the ranking', async () => {
    // Someone who deliberately moved to Personal must not be dragged back to
    // the company organization on the next relaunch. Whether the ENTITLEMENT
    // hunt can drag them back is a separate question, decided one layer up in
    // `selectEntitledOrg` — see the block at the bottom of this file (ENG-2199).
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
    // Moved to `selectEntitledOrg`, which is the only layer that knows where the
    // session finally lands. Writing here is what let `state.json` and the live
    // session name different organizations (ENG-2199).
    let landed = PERSONAL;
    installRoutedFetch(
      keycloakRoutes([PERSONAL, ACME, BETA], () => landed).map((route) =>
        route.method === 'PUT'
          ? { ...route, reply: (call: RoutedCall) => { const id = JSON.parse(call.body!).id; landed = [PERSONAL, ACME, BETA].find((o) => o.id === id)!; return { status: 204, body: {} }; } }
          : route),
    );

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
    // The credential the sidecar presents has to be the re-rolled token, or
    // turns keep billing the organization the person just left while the menu
    // says otherwise. Nothing is minted and nothing is stored.
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/runtime-credential/minds'))!;
    expect(orgOfToken(`Bearer ${JSON.parse(put.body!).value}`)).toBe(ACME.id);
    expect(put.auth).toBe('Bearer owner-token');
    expect(calls.filter((c) => c.url.includes('/api-keys/'))).toHaveLength(0);
    // And the pick is remembered, so the ranking does not undo it next launch.
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
    expect(refused.error).toMatch(/still settling which organization/i);
  });
});

// ── selectEntitledOrg ──────────────────────────────────────────────
//
// The layer the onboarding picker actually reaches, and the one that was
// untested when it shipped: every test above drives `ensureActiveOrg`, which
// honours a pick, while the override that discards it lives here. That is why
// `honours a pick the person made, over the ranking` passed for the whole life
// of the bug (ENG-2199).
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
   * Keycloak + auth-service, with the entitlement answered PER ORGANIZATION.
   *
   * The `sidecarRoutes` stub above hardcodes an entitled answer, so nothing in
   * this file could reach the unentitled branch — which is the entire defect.
   * `entitled` names the organizations that can run turns; every other one
   * answers a well-formed 200 saying it cannot.
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
       * Keycloak refuses the switch BACK to where the hunt started, once it has
       * left. Distinct from `refuse`, which would also block the ranking's own
       * move on the way in — and it is only the return trip that models a
       * refused restore.
       */
      refuseReturn?: boolean;
    } = {},
  ) {
    let active = startIn;
    let tokenOrg = startIn;
    let refreshes = 0;
    // The ranking may move the session before the hunt begins, so "where the
    // hunt started" is the first organization the entitlement check ran against,
    // not the one the token arrived naming.
    let startedFrom = startIn.id;
    let sawFirstAuth = false;
    const calls = installRoutedFetch([
      // `orgsStatus` is Keycloak failing the membership read. It matters
      // because `listUserOrgs` returns `[]` for a failed read AND for a
      // genuinely empty membership, so nothing downstream can tell them apart.
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
          // A 503 is the transient branch of `doRefreshTokens`: it keeps the
          // existing tokens rather than clearing them, so the store goes on
          // naming the organization the previous refresh landed in.
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
    // The reported bug. Picking Personal put the user in Robot.com, because an
    // organization that cannot run turns was treated as an answer to revise
    // rather than as the answer. A wallet-empty organization is not a sign-in
    // blocker: the gateway raises the top-up card on the first turn.
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
    // The behaviour #748 was written for, and the reason the hunt is not simply
    // deleted: a user who never answered the question should not meet a paywall
    // when another of their organizations can pay.
    const net = entitlementRoutes([PERSONAL, ACME], PERSONAL, [ACME.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.organization?.id).toBe(ACME.id);
    // Recorded nowhere. Where a call happened to run is not evidence about what
    // the person wants, and `state.json` has one slot to overwrite with it.
    expect(storedRow()).toBeNull();
    expect(net.activeOrg().id).toBe(ACME.id);
  });

  it('puts the session back where it started when nothing can pay', async () => {
    // Without this the user is left in whichever organization the loop happened
    // to try last — an artifact of Keycloak's list order, not a choice. Note the
    // starting point is where the RANKING left the session (ACME, company-first),
    // not the personal organization the token arrived naming: ranking is not the
    // hunt, and only the hunt has to be undone.
    const net = entitlementRoutes([PERSONAL, ACME], PERSONAL, []);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(net.switches().at(-1)).toBe(ACME.id);
    expect(net.activeOrg().id).toBe(ACME.id);
    expect(result.organization?.id).toBe(ACME.id);
    expect(storedRow()).toBeNull();
  });

  it('does not re-open a choice the person made on an earlier run', async () => {
    // The Reconnect card calls finalize with no organization id, so without the
    // stored provenance the hunt would move a deliberate pick the moment a
    // session needed re-establishing — the same bug on a delay.
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
    // The other half of the provenance rule: "stored" must not mean "sacred", or
    // one automatic landing would pin the install to it permanently.
    // FORWARD GUARD. No code path writes `chosenByUser: false` any more, so this
    // row is seeded by hand: it pins the rule for whoever next reaches for
    // "remember where we ended up", which is the natural thing to try and the
    // thing that quietly reintroduces this ticket.
    seedRow(USER, ACME.id, false);
    entitlementRoutes([PERSONAL, ACME, BETA], ACME, [BETA.id]);

    const result = await selectEntitledOrg(tokenFor(ACME));

    expect(result.organization?.id).toBe(BETA.id);
    expect(storedRow()).toEqual({ sub: USER, orgId: ACME.id, chosenByUser: false });
  });

  it('does not treat a fallen-back-to organization as the person\'s choice', async () => {
    // `chosenByUser` says somebody answered, not that the session reached their
    // answer. Keycloak can refuse the switch, and `ensureActiveOrg` then falls
    // through to keep a usable claim — landing somewhere nobody picked. Left
    // ungated, that organization both suppresses the fallback (parking the user
    // somewhere that cannot pay while another organization could) and gets
    // stamped `chosenByUser: true`, which nothing would ever correct.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [PERSONAL.id], {
      refuse: [BETA.id],
    });

    const result = await selectEntitledOrg(tokenFor(PERSONAL), {
      preferOrgId: BETA.id,
      chosenByUser: true,
    });

    expect(net.switches()).toContain(BETA.id);
    // Beta was refused, so nothing here is the person's choice: the hunt runs
    // and finds the organization that can actually pay — and records nothing,
    // because they never chose where they ended up.
    expect(result.organization?.id).toBe(PERSONAL.id);
    expect(storedRow()).toBeNull();
  });

  it('does not erase a standing choice when the membership read fails', async () => {
    // Reconnect (`ChatView.jsx:1166`) calls finalize with no id and no flag. If
    // Keycloak's /orgs read blips, `listUserOrgs` answers `[]`, the stored
    // organization cannot be matched, and the session settles somewhere else —
    // and a write there would delete the only record of the person's pick,
    // permanently, on a session that merely reconnected.
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
    // The other half of leaving the record alone: the disagreement lasts only
    // as long as the outage. Without this, "do not overwrite" would just be a
    // quieter way to strand somebody.
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
    // Guards the opposite failure: "never overwrite a pick" must not become
    // "a pick is forever". The stored row may go stale, but it is inert —
    // `chooseMindsOrg` ignores a pick the person is no longer a member of, so
    // the ranking places them and the fallback still runs.
    //
    // Also the only cover for the stored branch's identity guard
    // (`stored.orgId === startedInOrgId`), the twin of `landedOnRequest`:
    // without it a stored pick the session never reached would protect
    // whatever the ranking happened to land on — Acme here, which cannot pay.
    fs.writeFileSync(
      `${TEST_HOME}/state.json`,
      JSON.stringify({ preferences: { mindsOrganization: { sub: USER, orgId: BETA.id, chosenByUser: true } } }),
    );
    entitlementRoutes([PERSONAL, ACME], PERSONAL, [PERSONAL.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.organization?.id).toBe(PERSONAL.id);
  });

  it('fails rather than reporting success when the restore cannot be confirmed', async () => {
    // Nothing qualifies, so the hunt exhausts and restores. If every restore
    // attempt lands but its refresh fails, the token never confirms the session
    // is back — and returning it would report "signed in" while the person sits
    // in an organization the loop happened to try last, chosen by Keycloak's
    // list order rather than by them. Recoverable, so it surfaces as an error
    // to retry rather than a silent relocation.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [], { failRefreshFrom: 4 });

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.token).toBeUndefined();
    expect(result.error).toMatch(/could not put this computer back/i);
    expect(fs.existsSync(`${TEST_HOME}/state.json`)).toBe(false);
    // The last two switches are both the restore: the thing that failed is the
    // thing being retried. (Counting every switch to this organization would
    // also catch the ranking's own move before the hunt began.)
    expect(net.switches().slice(-2)).toEqual([net.startedIn(), net.startedIn()]);
  });

  it('fails when Keycloak refuses to put the session back', async () => {
    // The other half of the restore failure, and the one that regressed first:
    // `restoreActiveOrg` used to `return true` on a REFUSED switch, on the
    // reasoning that the session never moved — but by then the hunt had already
    // moved it, so the person was left in whichever organization the loop tried
    // last and it was reported as a successful sign-in.
    //
    // Distinct from the refresh-failure case above: there the switch lands and
    // only the token lags. Here nothing moves back at all, so a guard that
    // checks the token alone would still pass.
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
    // The retry is the difference between a transient Keycloak wobble and
    // stranding somebody: without it, one bad refresh is enough to fail a
    // sign-in that was otherwise fine.
    const net = entitlementRoutes([PERSONAL, ACME, BETA], PERSONAL, [], { failRefreshOnce: 4 });

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.error).toBeUndefined();
    expect(result.organization?.id).toBe(net.startedIn());
  });

  it('does not let an organization it landed on outrank the ranking later', async () => {
    // `settleOn` records automatic landings so the row cannot disagree with the
    // session — but `chooseMindsOrg` prefers any stored id over
    // `rankMindsOrgs`, so without provenance one landing would retire the
    // company-first default (ENG-1954) for good. Signing in with only a
    // personal organization and later joining a company one is the case: the
    // hunt never corrects it, because Personal can pay.
    // FORWARD GUARD, seeded by hand — see the note on the revision test above.
    seedRow(USER, PERSONAL.id, false);
    entitlementRoutes([PERSONAL, ACME], PERSONAL, [PERSONAL.id, ACME.id]);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(result.organization?.id).toBe(ACME.id);
    expect(storedRow()).toEqual({ sub: USER, orgId: PERSONAL.id, chosenByUser: false });
  });

  it("leaves another account's pick alone on an ordinary sign-in", async () => {
    // `state.json` has ONE `mindsOrganization` slot. Account A switches to
    // Personal from the account menu; account B then signs in on the same
    // machine and never sees a picker. A write here would replace A's row —
    // `readStoredOrgPreference(B)` returns null for it, so no guard keyed on the
    // stored value can see it — and A never gets that choice back.
    const OTHER = 'user-other';
    seedRow(OTHER, BETA.id, true);
    entitlementRoutes([PERSONAL, ACME], ACME, [ACME.id]);

    await selectEntitledOrg(tokenFor(ACME));

    expect(storedRow()).toEqual({ sub: OTHER, orgId: BETA.id, chosenByUser: true });
  });

  it('does not switch at all when the hunt had nowhere to go', async () => {
    // A single-organization account that cannot pay: the loop skips the only
    // candidate because it is already active, so nothing moved and there is
    // nothing to put back. Restoring anyway would spend a Keycloak switch and a
    // token exchange on every such sign-in, which previously spent neither.
    const net = entitlementRoutes([PERSONAL], PERSONAL, []);

    const result = await selectEntitledOrg(tokenFor(PERSONAL));

    expect(net.switches()).toEqual([]);
    expect(result.organization?.id).toBe(PERSONAL.id);
  });

  it('honours a pick the session has to switch into, and records it', async () => {
    // The picker's own happy path, and the case the other `chosenByUser` tests
    // miss: each of those either starts in the chosen organization or has
    // Keycloak refuse the switch, so none of them proves a pick that must
    // actually be switched into is honoured once it is reached.
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
    // Both drive the same server-side Keycloak session, and this one switches
    // more than once. Interleaved, the restore lands after the switch and
    // silently undoes a change the person watched succeed.
    //
    // It waits rather than refusing because `ReconnectCard` escalates any
    // `ok: false` straight to `mindshubLogin()`, so refusing would put a full
    // browser sign-in in front of someone whose session was fine.
    let releaseSwitch: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseSwitch = resolve; });
    const members = [PERSONAL, ACME];
    let active = PERSONAL;
    let switchReached = false;
    // Every request, so "did the selection start work?" is answerable. Pending
    // is NOT enough on its own: with no lock the selection would run and block
    // on this same gate, which looks identical from the outside.
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
      // Not refused...
      expect(selectSettled).toBe(false);
      // ...and not merely blocked on the same gate: it has issued nothing at
      // all, because it is parked on the lock. Without the lock it reaches
      // `/orgs` immediately.
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
    // And it did run, once the switch was done.
    expect(seen.length).toBeGreaterThan(before);
    // On the token the switch left behind, not the one captured before the
    // wait. Acting on the stale claim lets `ensureActiveOrg` fall back to it
    // and move the session off the organization just chosen.
    // The membership read is the one that carries the claim `ensureActiveOrg`
    // acts on; other authed calls here present the sidecar's own owner token.
    const membershipRead = seen.slice(before).find((call) => call.url.includes('/orgs'));
    expect(membershipRead?.auth).toBeTruthy();
    expect(orgOfToken(membershipRead!.auth!)).toBe(ACME.id);
  });

  it('never records an organization the person does not belong to', async () => {
    // The renderer supplies the id, so it is the untrusted end of this call. It
    // reaches a membership check before anything else, and an id that fails it
    // must not reach the state file either.
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
