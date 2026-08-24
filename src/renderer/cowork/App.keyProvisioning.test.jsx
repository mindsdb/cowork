// ENG-1533: the `unhandled` outcome of key_provisioning_refused — the SSO
// sign-in path, where a 402 from finalize leaves the user signed in with no
// working key, no BYOK route and no message. Nothing acts on that result by
// design (key provisioning is not a sign-in gate), so the only thing standing
// between the read and silence is this test: without it the
// `?.upgradeRequired` read can be deleted and the suite stays green, which is
// exactly what review pointed out.
//
// Mounting pattern copied from App.askUser.send.test.jsx — the one other file
// that renders the whole App — because `handleSsoSignIn` is an inner closure,
// not an exported helper.
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

// Spread the real host and override only what this path needs. `isElectron`
// must be true — every SSO affordance is gated on it — but the real host
// methods stay web-safe under happy-dom, so nothing reaches for a bridge.
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
    // A non-402 failure is not a refusal. Counting it would put ordinary
    // failures into a metric meant to size a paywall cohort.
    //
    // Resolved rather than rejected on purpose: a rejection throws at the
    // `await`, so control jumps to the catch and the `?.upgradeRequired` read
    // never executes — the assertion would then pass with that read deleted,
    // which is the thing it exists to protect. A resolved non-refusal shape
    // runs the guard and takes the false branch.
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
