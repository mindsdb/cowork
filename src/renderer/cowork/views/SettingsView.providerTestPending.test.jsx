import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// ENG-1113 regression: opening Settings often flashed "MindsHub failed its last
// test — check it under LLM Providers above…" for a beat before it vanished.
// The message is driven by a *persisted* providerStatus that can be a stale
// 'fail' from a transient blip last session; the once-per-mount background
// verify then flips it to 'ok'. The hard error must stay hidden while that
// verify is in flight (a "Checking… connection" line stands in for it), and it
// must never appear at all when the verify resolves green.

let deferred;
const spies = vi.hoisted(() => ({ testProviders: vi.fn() }));

vi.mock('../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: spies.testProviders,
}));
vi.mock('../../platform/host', () => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('./ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

// A stateful host so setSetting('providerStatus', …) actually updates the
// rendered props the way the real parent does — that's what makes the stale
// 'fail' converge to 'ok' when the verify lands.
function Harness({ initialSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  return (
    <SettingsView
      settings={settings}
      setSetting={setSetting}
      onSave={vi.fn(async () => {})}
      theme="dark"
      onThemeChange={vi.fn()}
      skin="default"
      onSkinChange={vi.fn()}
      customTheme={{}}
      onCustomThemeChange={vi.fn()}
      agentLabel="Anton"
      serverOnline
      section="agent"
      onSectionChange={vi.fn()}
    />
  );
}

const baseSettings = () => ({
  modelMode: 'default',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
  providerStatus: { 'minds-cloud': 'fail' },
  providerStatusDetails: { 'minds-cloud': 'ReadTimeout' },
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
});

describe('SettingsView model picker — provider test in flight (ENG-1113)', () => {
  beforeEach(() => {
    deferred = {};
    deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
    spies.testProviders.mockReset();
    spies.testProviders.mockReturnValue(deferred.promise);
  });

  it('hides the "failed its last test" warning while the verify is pending', async () => {
    render(<Harness initialSettings={baseSettings()} />);

    // The mount-time verify fired and is still pending: no red error, a
    // checking line instead.
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());
    // One checking line per role row (planning/router/coding).
    const checking = await screen.findAllByText(/Checking MindsHub connection/i);
    expect(checking.length).toBeGreaterThan(0);
    expect(screen.queryByText(/failed its last test/i)).toBeNull();
  });

  it('never shows the warning when the verify resolves ok', async () => {
    render(<Harness initialSettings={baseSettings()} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    deferred.resolve({ providerStatus: { 'minds-cloud': 'ok' }, providerStatusDetails: {} });

    await waitFor(() => expect(screen.queryByText(/Checking MindsHub connection/i)).toBeNull());
    expect(screen.queryByText(/failed its last test/i)).toBeNull();
  });

  it('shows the LLM Providers row as "testing…" while a re-verify of an ok provider is pending', async () => {
    // A provider resting at 'ok' collapses its key input to a status pill, so
    // the badge is what a background re-verify surfaces: it reads 'testing…'
    // rather than a stale 'connected' while the request is in flight.
    render(<Harness initialSettings={{
      ...baseSettings(),
      providerStatus: { 'minds-cloud': 'ok' },
      providerStatusDetails: {},
    }} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    await screen.findByText(/testing…/i);

    deferred.resolve({ providerStatus: { 'minds-cloud': 'ok' }, providerStatusDetails: {} });
    await waitFor(() => expect(screen.queryByText(/testing…/i)).toBeNull());
    expect(screen.getAllByText(/connected/i).length).toBeGreaterThan(0);
  });

  it('shows the warning once the verify resolves with a genuine failure', async () => {
    render(<Harness initialSettings={baseSettings()} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    deferred.resolve({ providerStatus: { 'minds-cloud': 'fail' }, providerStatusDetails: { 'minds-cloud': 'HTTP 401' } });

    // Verify settled → the stale-vs-fresh distinction no longer matters; the
    // real failure surfaces (for all three role rows).
    await waitFor(() => expect(screen.queryByText(/Checking MindsHub connection/i)).toBeNull());
    expect(screen.getAllByText(/failed its last test/i).length).toBeGreaterThan(0);
  });

  it('holds back the "No credits available" banner too while the verify is pending', async () => {
    // A stale 402/429/quota fail otherwise flashes the no-credits banner during
    // the verify window — the same flash-of-stale-error ENG-1113 targets, via a
    // sibling notice. It must yield to the checking line until the test lands.
    render(<Harness initialSettings={{
      ...baseSettings(),
      providerStatusDetails: { 'minds-cloud': 'HTTP 429' },
    }} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    expect(screen.queryByText(/No credits available/i)).toBeNull();
    expect((await screen.findAllByText(/Checking MindsHub connection/i)).length).toBeGreaterThan(0);

    // Resolves to a genuine quota failure → the banner now surfaces.
    deferred.resolve({ providerStatus: { 'minds-cloud': 'fail' }, providerStatusDetails: { 'minds-cloud': 'HTTP 429' } });
    await waitFor(() => expect(screen.getAllByText(/No credits available/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Checking MindsHub connection/i)).toBeNull();
  });
});
