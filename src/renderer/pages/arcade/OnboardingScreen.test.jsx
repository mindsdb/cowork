import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  restartServer: vi.fn(async () => {}),
}));
// Mutable keycloak mock so a test can flip authenticated (standalone/localhost
// auto-finalize path). Hosted cloud never authenticates here → stays false.
const keycloakMock = vi.hoisted(() => ({ authenticated: false }));
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

    await waitFor(() => expect(screen.getByText(/Your workspace is ready to go/)).toBeInTheDocument());
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
    hostMock.mindshubLogin = vi.fn(async () => ({ ok: false, reason: 'unused in these tests' }));
    hostMock.mindshubFinalize = vi.fn(async () => ({ ok: true, apiKey: 'mdb_t' }));
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
    expect(written).toContain('ANTON_MINDS_API_KEY=mdb_test_key');
    expect(written).toContain('ANTON_PLANNING_PROVIDER=minds-cloud');
    expect(written).toContain('ANTON_CODING_PROVIDER=minds-cloud');
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
