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
vi.mock('../../lib/syncSettings', () => ({
  syncSettingsToDb: vi.fn(async () => true),
  syncModelsToDb: vi.fn(async () => {}),
  modelLinesFrom: (lines) => lines.filter((l) => /^ANTON_(PLANNING|CODING)_MODEL=/.test(l)),
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
