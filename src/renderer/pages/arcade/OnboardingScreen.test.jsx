import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
vi.mock('../../lib/syncSettings', () => ({ syncSettingsToDb: vi.fn(async () => true) }));

import OnboardingScreen from './OnboardingScreen';

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
    (await screen.findByRole('button', { name: /Create one for free/ })).click();
  };

  it('Create one for free drives the loopback signup flow, not a fire-and-forget link', async () => {
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
      expect(screen.getByRole('button', { name: 'Sign in with MindsHub' })).toBeEnabled(),
    );
    expect(screen.queryByText('FINISH SIGN-UP IN YOUR BROWSER')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
