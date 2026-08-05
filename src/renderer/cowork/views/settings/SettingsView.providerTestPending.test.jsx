import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// ENG-1113: a persisted failure must stay hidden until the mount-time provider
// check decides whether it is still current.

let deferred;
const spies = vi.hoisted(() => ({ testProviders: vi.fn() }));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: spies.testProviders,
}));
vi.mock('../../../platform/host', () => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

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

    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());
    const checking = await screen.findAllByText(/Checking MindsHub connection/i);
    expect(checking.length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Testing…')).toBeInTheDocument();
    expect(screen.queryByLabelText('minds API key')).toBeNull();
    expect(screen.queryByText(/failed its last test/i)).toBeNull();
    expect(screen.queryByText(/did not respond in time/i)).toBeNull();
  });

  it('never shows the warning when the verify resolves ok', async () => {
    render(<Harness initialSettings={baseSettings()} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    deferred.resolve({ providerStatus: { 'minds-cloud': 'ok' }, providerStatusDetails: {} });

    await waitFor(() => expect(screen.getByLabelText(/^Last test passed/)).toBeInTheDocument());
    expect(screen.queryByLabelText('minds API key')).toBeNull();
    expect(screen.queryByText(/failed its last test/i)).toBeNull();
  });

  it('shows the warning once the verify resolves with a genuine failure', async () => {
    render(<Harness initialSettings={baseSettings()} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    deferred.resolve({ providerStatus: { 'minds-cloud': 'fail' }, providerStatusDetails: { 'minds-cloud': 'HTTP 401' } });

    await waitFor(() => expect(screen.queryByText(/Checking MindsHub connection/i)).toBeNull());
    expect(screen.getByLabelText('minds API key')).toBeInTheDocument();
    expect(screen.getAllByText(/failed its last test/i).length).toBeGreaterThan(0);
  });

  it('holds back the "No credits available" banner too while the verify is pending', async () => {
    render(<Harness initialSettings={{
      ...baseSettings(),
      providerStatusDetails: { 'minds-cloud': 'HTTP 429' },
    }} />);
    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());

    expect(screen.queryByText(/No credits available/i)).toBeNull();
    expect((await screen.findAllByText(/Checking MindsHub connection/i)).length).toBeGreaterThan(0);

    deferred.resolve({ providerStatus: { 'minds-cloud': 'fail' }, providerStatusDetails: { 'minds-cloud': 'HTTP 429' } });
    await waitFor(() => expect(screen.getAllByText(/No credits available/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Checking MindsHub connection/i)).toBeNull();
  });
});
