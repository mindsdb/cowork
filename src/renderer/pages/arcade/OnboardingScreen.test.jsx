import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PERSONAL_ORG_LABEL } from '../../../shared/minds-orgs';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mutable host mock — flip isWeb / checkConfigured per test. ENG-912: a
// console-hosted (web) instance is pre-provisioned (config_ready:true, key
// seeded server-side, unreadable via the loopback-gated /raw), so onboarding
// must offer consent-only entry instead of a MindsHub-key prompt.
const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  isMac: () => false,
  checkConfigured: vi.fn(async () => ({ configured: true, provider: 'minds_cloud' })),
  openExternal: vi.fn(),
  saveSettings: vi.fn(async () => true),
  validateProvider: vi.fn(async () => ({ ok: true })),
  readSettings: vi.fn(async () => ({})),
  // Between signing in and minting, the screen asks which organization the key
  // belongs to. One organization is the default answer here, so every existing
  // test below goes straight to the mint as it always did.
  mindshubListOrgs: vi.fn(async () => ({ orgs: [], activeOrgId: null })),
}));
// Mutable keycloak mock so a test can flip authenticated (standalone/localhost
// auto-finalize path). Hosted cloud never authenticates here → stays false.
const keycloakMock = vi.hoisted(() => ({ authenticated: false }));
// ENG-1533: the only analytics this screen emits is the provisioning-refusal
// fork. Mocked so the assertion is on the call, not on a network POST.
const analyticsMock = vi.hoisted(() => ({ trackKeyProvisioningRefused: vi.fn() }));
vi.mock('../../cowork/lib/analytics', () => analyticsMock);
vi.mock('../../platform/host', () => ({ host: hostMock }));
vi.mock('../../cowork/api', () => ({ BASE: '/api/v1', fetchRecommendedModels: vi.fn(async () => ({})) }));
vi.mock('../../lib/keycloak', () => ({ keycloak: keycloakMock }));
// Keep the REAL pure helpers (modelLinesFrom) — mock only the I/O functions —
// so the component test can't pass on a broken modelLinesFrom (no mock/real drift).
vi.mock('../../lib/syncSettings', async (importActual) => ({
  ...(await importActual()),
  syncSettingsToDb: vi.fn(async () => true),
  syncModelsToDb: vi.fn(async () => true),
}));

import OnboardingScreen from './OnboardingScreen';
// The syncSettings module is mocked above; grab the mocked syncToDb so a test
// can make it fail (simulating the server not being up yet during onboarding).
import { syncSettingsToDb } from '../../lib/syncSettings';

const coworker = { id: 'anton', label: 'ANTON', sprite: 'anton' };

describe('OnboardingScreen — configured cloud instance (ENG-912)', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
    hostMock.isElectron = false;
    hostMock.checkConfigured = vi.fn(async () => ({ configured: true, provider: 'minds_cloud' }));
    keycloakMock.authenticated = false;
    // syncModels/syncHarness fetch directly; keep them from throwing so the
    // auto-finalize path can reach 'success' rather than the error screen.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  it('web + config_ready:true → consent-only screen, no MindsHub key prompt', async () => {
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument(),
    );
    // The key-entry prompt must NOT appear for an already-configured instance...
    expect(screen.queryByText('MindsHub API Key')).toBeNull();
    // ...but terms consent is still shown (never silently recorded).
    expect(screen.getByRole('button', { name: 'Terms of Service' })).toBeInTheDocument();
  });

  it('Continue records consent + enters the app via onComplete', async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen coworker={coworker} onComplete={onComplete} />);
    const btn = await screen.findByRole('button', { name: 'Continue' });
    btn.click();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('web + config_ready:false → full provider flow (key prompt), no short-circuit', async () => {
    hostMock.checkConfigured = vi.fn(async () => ({ configured: false, provider: '' }));
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    await waitFor(() => expect(screen.getByText('MindsHub API Key')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  // PR #445 review: the keycloak auto-finalize path (authenticated
  // standalone/localhost) must yield deterministically — never flash the
  // provider key form or the consent screen. Driven by state, not the ref.
  it('web + config_ready:true + keycloak authenticated → auto-finalizes, never shows the key form or consent screen', async () => {
    keycloakMock.authenticated = true;
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    // Auto-finalize completes → success screen.
    await waitFor(() => expect(screen.getByText(/You're all set/)).toBeInTheDocument());
    // The provider key form and the manual consent Continue never appeared.
    expect(screen.queryByText('MindsHub API Key')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  // The live cloud bug: hosted org deployments DO authenticate through Keycloak,
  // so the path above fired there and wrote admin-only provider keys. The 403 set
  // phase='error', which bypasses both branches below (each guarded
  // `phase !== 'error'`), trapping members on the key form on every reload.
  it('web + org_mode:true → consent-only, writes NOTHING (no org-setting 403 trap)', async () => {
    keycloakMock.authenticated = true;
    hostMock.checkConfigured = vi.fn(async () => ({
      configured: true,
      provider: 'minds_cloud',
      orgMode: true,
    }));
    // Module mocks persist across cases in this file, so the write assertions
    // below would otherwise see the previous test's auto-finalize call.
    syncSettingsToDb.mockClear();
    hostMock.saveSettings.mockClear();

    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);

    // Assert the product name and the new body outright: a regex loose enough to
    // also match the old copy would pass whether or not this screen names itself.
    await waitFor(() => expect(screen.getByText('MindsHub Cowork')).toBeInTheDocument());
    expect(screen.getByText(/Give the agent a task/)).toBeInTheDocument();
    expect(screen.queryByText('MindsHub API Key')).toBeNull();
    // The org-classified write never happens — that 403 is what trapped members.
    expect(syncSettingsToDb).not.toHaveBeenCalled();
    expect(hostMock.saveSettings).not.toHaveBeenCalled();
  });
});

// ENG-917: desktop sign-up rides the same loopback PKCE flow as sign-in —
// the app must hear the flow complete (including after the email-verification
// pause) instead of firing an external link and going deaf.
describe('OnboardingScreen — desktop sign-up returns to the app (ENG-917)', () => {
  beforeEach(() => {
    hostMock.isWeb = false;
    hostMock.isElectron = true;
    hostMock.openExternal = vi.fn();
    hostMock.oauthCancel = vi.fn(async () => {});
    hostMock.checkInstall = vi.fn(async () => ({ antonInstalled: true, serverDepsReady: true }));
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [], activeOrgId: null }));
    hostMock.mindshubLogin = vi.fn(async () => ({ ok: false, reason: 'unused in these tests' }));
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true }));
    // Electron routes a pasted MindsHub key to main instead of writing it as an
    // env line, so `supported: true` is what these Electron-shell tests exercise.
    hostMock.mindshubSetUserKey = vi.fn(async () => ({ ok: true, supported: true }));
    keycloakMock.authenticated = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  const clickCreateAccount = async () => {
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    (await screen.findByRole('button', { name: /Create a free account/ })).click();
  };

  it('Create a free account drives the loopback signup flow, not a fire-and-forget link', async () => {
    let resolveSignup;
    hostMock.mindshubSignup = vi.fn(() => new Promise((r) => { resolveSignup = r; }));
    await clickCreateAccount();
    await waitFor(() => expect(hostMock.mindshubSignup).toHaveBeenCalledTimes(1));
    expect(hostMock.openExternal).not.toHaveBeenCalled();
    // The wait state sets the email-verification expectation and offers Cancel.
    expect(screen.getByText('FINISH SIGN-UP IN YOUR BROWSER')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    resolveSignup({ ok: false, reason: 'cancelled' }); // let the pending promise settle
  });

  it('completed signup finalizes like sign-in — no second sign-in required', async () => {
    hostMock.mindshubSignup = vi.fn(async () => ({ ok: true, access_token: 'kc-t' }));
    await clickCreateAccount();
    await waitFor(() => expect(hostMock.mindshubFinalize).toHaveBeenCalledTimes(1));
  });

  it('signup timeout degrades to a sign-in nudge, never an error', async () => {
    hostMock.mindshubSignup = vi.fn(async () => (
      { ok: false, reason: 'OAuth timed out — no callback received within 30 minutes.' }
    ));
    await clickCreateAccount();
    await waitFor(() => expect(screen.getByText(/one click away/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a cancelled signup returns quietly to the idle sign-in screen', async () => {
    hostMock.mindshubSignup = vi.fn(async () => ({ ok: false, reason: 'cancelled' }));
    await clickCreateAccount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled(),
    );
    expect(screen.queryByText('FINISH SIGN-UP IN YOUR BROWSER')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ENG-922: on a fresh desktop install the cowork-server isn't up during
// onboarding, so the DB write fails and finalizeSettings DEFERS to the install
// screen. persistOnboarding returns before syncModels, and the post-install
// bulk .env re-sync excludes model keys (ENG-739) — so unless the chosen model
// is handed to onComplete for a one-time replay, a non-Anthropic BYOK user lands
// config-not-ready ("Select a model"). This locks the OnboardingScreen half of
// that wiring (the App-side replay is exercised by the manual clean-machine E2E).
describe('OnboardingScreen — BYOK setup-deferral hands the model up (ENG-922)', () => {
  beforeEach(() => {
    hostMock.isWeb = false;      // desktop
    hostMock.isElectron = true;
    keycloakMock.authenticated = false;
    hostMock.validateProvider = vi.fn(async () => ({ ok: true }));
    hostMock.saveSettings = vi.fn(async () => true);   // .env write succeeds (IPC, no server needed)
    hostMock.readSettings = vi.fn(async () => ({}));
    // The race: cowork-server not installed yet → DB sync fails AND checkInstall
    // reports not-ready → resolveFinalizeOutcome returns 'defer'.
    hostMock.checkInstall = vi.fn(async () => ({ antonInstalled: false, serverDepsReady: false }));
    syncSettingsToDb.mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  it('defers with a failed DB sync + uninstalled server → onComplete receives the chosen model lines', async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen coworker={coworker} onComplete={onComplete} />);

    // Electron start screen → drop into BYOK ("continue without an account").
    fireEvent.click(await screen.findByRole('button', { name: /Continue without an account/ }));
    // Custom (openai-compatible): free-text base URL + model — the exact
    // config-not-ready case (no server-side default model).
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter model name...'), {
      target: { value: 'llama-3.3-70b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    // The just-chosen model is handed up for the post-install replay — never dropped.
    expect(onComplete).toHaveBeenCalledWith(
      expect.arrayContaining([
        'ANTON_PLANNING_MODEL=llama-3.3-70b',
        'ANTON_CODING_MODEL=llama-3.3-70b',
      ]),
    );
  });

  it('errors (does NOT defer) when the DB sync fails but the server IS installed', async () => {
    // Regression guard: a real DB failure against a ready server must still
    // surface the retryable error, not silently proceed.
    hostMock.checkInstall = vi.fn(async () => ({ antonInstalled: true, serverDepsReady: true }));
    const onComplete = vi.fn();
    render(<OnboardingScreen coworker={coworker} onComplete={onComplete} />);

    fireEvent.click(await screen.findByRole('button', { name: /Continue without an account/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter model name...'), {
      target: { value: 'llama-3.3-70b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onComplete).not.toHaveBeenCalled();
  });
});
// ENG-1533: on first run a provisioning refusal does NOT show a paywall — it
// offers BYOK. That is why the refusal is its own event carrying an `outcome`,
// rather than a `billing_opened` trigger: on the commonest path there is no
// billing open to record.
describe('OnboardingScreen — a refused key routes to BYOK and is counted (ENG-1533)', () => {
  beforeEach(() => {
    hostMock.isWeb = false;
    hostMock.isElectron = true;
    hostMock.openExternal = vi.fn();
    hostMock.saveSettings = vi.fn(async () => true);
    hostMock.checkInstall = vi.fn(async () => ({ antonInstalled: true, serverDepsReady: true }));
    hostMock.mindshubSignup = vi.fn(async () => ({ ok: true, access_token: 'kc-t' }));
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [], activeOrgId: null }));
    keycloakMock.authenticated = false;
    analyticsMock.trackKeyProvisioningRefused.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  it('records outcome=byok_offered when MindsHub declines to mint a key', async () => {
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: false, upgradeRequired: true }));
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    (await screen.findByRole('button', { name: /Create a free account/ })).click();

    await waitFor(() =>
      expect(analyticsMock.trackKeyProvisioningRefused).toHaveBeenCalledWith('byok_offered'),
    );
    // The consent write is the BYOK route's first step — proof the outcome name
    // matches what the handler actually did.
    expect(hostMock.saveSettings).toHaveBeenCalledWith('ANTON_TERMS_CONSENT=true');
  });

  it('records nothing when the key is provisioned normally', async () => {
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true }));
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    (await screen.findByRole('button', { name: /Create a free account/ })).click();

    await waitFor(() => expect(hostMock.mindshubFinalize).toHaveBeenCalledTimes(1));
    expect(analyticsMock.trackKeyProvisioningRefused).not.toHaveBeenCalled();
  });
});

// The MindsHub path used to probe twice: once on the free model (server-side),
// then again on the recommended *paid* model. An empty wallet denies the paid
// one, and that denial was read as a broken key, so a brand-new user was sent to
// bring-your-own-key holding a MindsHub key that worked. The second probe told us
// nothing the first had not, so the fix is that it is gone.
describe('OnboardingScreen — the MindsHub path probes once, on the free model', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
    hostMock.isElectron = false;
    hostMock.checkConfigured = vi.fn(async () => ({ configured: false, provider: '' }));
    hostMock.validateProvider = vi.fn(async () => ({ ok: true }));
    hostMock.saveSettings = vi.fn(async () => true);
    hostMock.readSettings = vi.fn(async () => ({}));
    keycloakMock.authenticated = false;
    syncSettingsToDb.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  const connectWithMindsKey = async (onComplete = () => {}) => {
    render(<OnboardingScreen coworker={coworker} onComplete={onComplete} />);
    await waitFor(() => expect(screen.getByText('MindsHub API Key')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('mdb_...'), {
      target: { value: 'mdb_test_key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  };

  it('sends exactly one probe, and never names a model', async () => {
    await connectWithMindsKey();

    // The count is the assertion that matters, and it is checked only after the
    // flow has settled on the success screen: the old code reached 2, but it
    // passes through 1 on the way, so a waitFor on the count alone would go
    // green against the very code this replaces.
    await waitFor(() => expect(screen.getByText(/You're all set/)).toBeInTheDocument());
    expect(hostMock.validateProvider).toHaveBeenCalledTimes(1);
    // Every call, not just the first. The paid model rode the *second* probe, so
    // asserting the first one carried no model would have passed before too.
    for (const [provider, key, , model] of hostMock.validateProvider.mock.calls) {
      expect(provider).toBe('minds');
      expect(key).toBe('mdb_test_key');
      expect(model).toBeUndefined();
    }
  });

  it('commits minds-cloud as the provider for both roles', async () => {
    // The finalize lines were rewritten by the same diff and nothing else reads
    // them back. Dropping either one leaves onboarding "successful" with the app
    // pointed at no provider.
    await connectWithMindsKey();

    await waitFor(() => expect(hostMock.saveSettings).toHaveBeenCalled());
    const written = hostMock.saveSettings.mock.calls.map(([c]) => c).join('\n');
    expect(written).toContain('ANTON_PLANNING_PROVIDER=minds-cloud');
    expect(written).toContain('ANTON_CODING_PROVIDER=minds-cloud');
  });

  it('hands a pasted MindsHub key to main and writes it nowhere', async () => {
    // The key the user typed must reach the keychain by IPC and leave no env
    // line behind — a line here is a long-lived bearer back on disk, which is
    // the whole defect this path was changed to remove.
    await connectWithMindsKey();

    await waitFor(() => expect(hostMock.saveSettings).toHaveBeenCalled());
    expect(hostMock.mindshubSetUserKey).toHaveBeenCalledWith('mdb_test_key');
    const written = hostMock.saveSettings.mock.calls.map(([c]) => c).join('\n');
    expect(written).not.toContain('ANTON_MINDS_API_KEY');
    expect(written).not.toContain('mdb_test_key');
  });

  it('a wallet-denied paid model can no longer route onboarding to BYOK', async () => {
    // What a $0 wallet used to answer on the second probe. With one probe left,
    // there is no call for this to fail, so the BYOK step must not appear.
    hostMock.validateProvider = vi.fn(async (provider) =>
      provider === 'minds'
        ? { ok: true }
        : { ok: false, error: 'HTTP 402: wallet balance is empty' },
    );
    await connectWithMindsKey();

    // Settle on the success screen first. Waiting on the call count would resolve
    // the moment it hit 1, which the two-probe version also does.
    await waitFor(() => expect(screen.getByText(/You're all set/)).toBeInTheDocument());
    expect(hostMock.validateProvider).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Anthropic')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an invalid key still stops onboarding with the error surfaced', async () => {
    // The remaining probe keeps its job: a key that does not work must not pass.
    hostMock.validateProvider = vi.fn(async () => ({ ok: false, error: 'Invalid API key' }));
    await connectWithMindsKey();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Invalid API key/)).toBeInTheDocument();
  });
});

// ── Which organization the key is minted in ───────────────────────
//
// An API key belongs to whatever organization the token names when it is
// minted, and nothing used to influence that in the user's favour: a Beta Labs
// employee whose console tab happened to have Personal active got a key their
// company could neither pay for nor revoke. Ranking fixes the common case in
// the main process; this screen covers the one it cannot answer on its own,
// which is an account belonging to two company organizations.
describe('OnboardingScreen — choosing an organization at sign-in', () => {
  const ACME = { id: 'org-acme', name: 'acme.example', displayName: 'acme.example', isPersonal: false };
  const BETA = { id: 'org-beta', name: 'beta.example', displayName: 'Beta Labs', isPersonal: false };
  const PERSONAL = {
    id: 'org-personal',
    name: 'personal_user-1',
    displayName: "hazem@example.com's organization",
    isPersonal: true,
  };

  beforeEach(() => {
    hostMock.isWeb = false;
    hostMock.isElectron = true;
    hostMock.openExternal = vi.fn();
    hostMock.saveSettings = vi.fn(async () => true);
    hostMock.checkInstall = vi.fn(async () => ({ antonInstalled: true, serverDepsReady: true }));
    hostMock.mindshubLogin = vi.fn(async () => ({ ok: true, access_token: 'kc-t' }));
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true, apiKey: 'mdb_t', organization: ACME }));
    keycloakMock.authenticated = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  const signIn = async () => {
    render(<OnboardingScreen coworker={coworker} onComplete={() => {}} />);
    (await screen.findByRole('button', { name: 'Sign in' })).click();
  };

  it('asks nothing of a personal-only account, and mints straight away', async () => {
    // The path every existing user is on. It has to look exactly as it did.
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [PERSONAL], activeOrgId: PERSONAL.id }));
    await signIn();
    await waitFor(() => expect(hostMock.mindshubFinalize).toHaveBeenCalledTimes(1));
    expect(hostMock.mindshubFinalize).toHaveBeenCalledWith(undefined);
    expect(screen.queryByText('Choose an organization')).toBeNull();
  });

  it('asks nothing when there is one company organization to rank ahead', async () => {
    // Ranking already has the answer, and a picker with one real option is a
    // question that reads as a decision the person has to make.
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [ACME, PERSONAL], activeOrgId: PERSONAL.id }));
    await signIn();
    await waitFor(() => expect(hostMock.mindshubFinalize).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Choose an organization')).toBeNull();
  });

  it('offers a pick for two company organizations, defaulting to the first', async () => {
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [ACME, BETA, PERSONAL], activeOrgId: PERSONAL.id }));
    await signIn();
    await screen.findByText('Choose an organization');
    // Nothing is minted until the person answers.
    expect(hostMock.mindshubFinalize).not.toHaveBeenCalled();
    // The default is the first company organization, which is the answer the
    // ranking would have reached on its own.
    expect(screen.getByRole('radio', { name: /acme\.example/ })).toBeChecked();
    // The personal organization is offered too: someone may deliberately want it.
    // Listed as `Personal`, not as auth's generated `<email>'s organization` —
    // the picker names it the same way the account menu does (ENG-2109).
    expect(screen.getByRole('radio', { name: new RegExp(PERSONAL_ORG_LABEL) })).toBeInTheDocument();
  });

  it('mints in the organization that was picked', async () => {
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [ACME, BETA, PERSONAL], activeOrgId: PERSONAL.id }));
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true, apiKey: 'mdb_t', organization: BETA }));
    await signIn();
    await screen.findByText('Choose an organization');
    fireEvent.click(screen.getByRole('radio', { name: /Beta Labs/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(hostMock.mindshubFinalize).toHaveBeenCalledWith(BETA.id));
  });

  it('names the organization the key actually landed in', async () => {
    // Not the one it asked for: the entitlement and personal-organization
    // fallbacks in main can still move it, and saying the wrong name is how
    // someone believes their usage is billed somewhere it is not.
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [ACME, PERSONAL], activeOrgId: PERSONAL.id }));
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true, apiKey: 'mdb_t', organization: PERSONAL }));
    await signIn();
    await waitFor(() => expect(screen.getByText(/Working in/)).toBeInTheDocument());
    // `Personal` rather than auth's generated label, same rule as everywhere
    // else the product names an organization (ENG-2109). The assertion that
    // matters is unchanged: it names the organization the key LANDED in.
    expect(screen.getByText(PERSONAL_ORG_LABEL)).toBeInTheDocument();
  });

  it('says nothing about an organization when the mint did not report one', async () => {
    hostMock.mindshubListOrgs = vi.fn(async () => ({ orgs: [], activeOrgId: null }));
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true, apiKey: 'mdb_t' }));
    await signIn();
    await waitFor(() => expect(hostMock.mindshubFinalize).toHaveBeenCalled());
    expect(screen.queryByText(/Working in/)).toBeNull();
  });
});
