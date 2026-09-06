// SSO key-provisioning refusal does not block sign-in; preserve the unhandled analytics outcome
// when no working key is provisioned.
// Mount App because the sign-in handler is an inner closure.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  mindshubLogin: vi.fn(async () => ({ ok: true })),
  mindshubFinalize: vi.fn(async () => ({ ok: true })),
  trackKeyProvisioningRefused: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => []),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
}));

// Spread the real host with isElectron:true for SSO UI; absent happy-dom bridge keeps unoverridden
// methods web-safe.
vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: true,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: () => () => {},
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
      mindshubLogin: (...args) => spies.mindshubLogin(...args),
      mindshubFinalize: (...args) => spies.mindshubFinalize(...args),
    },
    // Signed out: keeps the sidebar on its "Settings" footer button and the
    // settings header on its "Sign in" affordance.
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: true,
  };
});

vi.mock('./lib/analytics', () => ({
  trackDataSourceConnected: vi.fn(),
  trackArtifactBuilt: vi.fn(),
  trackAgentSessionStarted: vi.fn(),
  trackAppInstalled: vi.fn(),
  trackFirstQuery: vi.fn(),
  trackFirstResponse: vi.fn(),
  classifyFirstResponse: vi.fn(() => null),
  trackKeyProvisioningRefused: (...args) => spies.trackKeyProvisioningRefused(...args),
}));

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';

/** Mounts App and runs the SSO sign-in from the settings header. */
async function signIn(user) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  await user.click(await screen.findByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  __resetDraftsForTests();
  spies.trackKeyProvisioningRefused.mockClear();
  spies.mindshubLogin.mockReset().mockResolvedValue({ ok: true });
  spies.mindshubFinalize.mockReset().mockResolvedValue({ ok: true });
});

describe('key_provisioning_refused on the SSO sign-in path', () => {
  it('records the `unhandled` outcome when finalize refuses to mint a key', async () => {
    const user = userEvent.setup();
    spies.mindshubFinalize.mockResolvedValue({ ok: false, upgradeRequired: true });

    await signIn(user);

    await waitFor(() =>
      expect(spies.trackKeyProvisioningRefused).toHaveBeenCalledWith('unhandled'));
  });

  it('records nothing when the key is provisioned — a sign-in is not a refusal', async () => {
    const user = userEvent.setup();

    await signIn(user);

    await waitFor(() => expect(spies.mindshubFinalize).toHaveBeenCalled());
    expect(spies.trackKeyProvisioningRefused).not.toHaveBeenCalled();
  });

  it('records nothing when finalize fails for a reason other than a refusal', async () => {
    const user = userEvent.setup();
    // Resolve a non-refusal rather than reject: rejection would bypass the upgradeRequired guard
    // and fail to test its false branch.
    spies.mindshubFinalize.mockResolvedValue({ ok: false, reason: 'no session' });

    await signIn(user);

    await waitFor(() => expect(spies.mindshubFinalize).toHaveBeenCalled());
    expect(spies.trackKeyProvisioningRefused).not.toHaveBeenCalled();
  });

  it('records nothing when finalize rejects outright', async () => {
    const user = userEvent.setup();
    // The transport-failure case the above used to cover. Kept as its own test
    // rather than folded in, because it exercises the catch, not the guard.
    spies.mindshubFinalize.mockRejectedValue(new Error('socket hang up'));

    await signIn(user);

    await waitFor(() => expect(spies.mindshubFinalize).toHaveBeenCalled());
    expect(spies.trackKeyProvisioningRefused).not.toHaveBeenCalled();
  });
});
