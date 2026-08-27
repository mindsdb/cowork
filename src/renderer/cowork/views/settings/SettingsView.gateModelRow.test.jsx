import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';

// ENG-1851: the router row's copy follows the gate binding the server reports.

const spies = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => ''),
  getVersionInfo: vi.fn(async () => ({ app: '1.2.3', ui: null, source: 'bundled' })),
}));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
}));
vi.mock('../../../platform/host', () => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: spies.getVersionInfo,
  isElectron: true,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

// One factory: only the provider card, the role's provider, and `gate` decide
// what the router row says. Everything else in a real settings payload falls
// back inside SettingsView and does not touch this row's copy.
const settingsFor = (type, card, gate) => ({
  modelMode: 'default',
  planningProvider: type,
  codingProvider: type,
  routerProvider: type,
  providers: [card],
  providerStatus: { [type]: 'ok' },
  providerTypeLabels: { 'minds-cloud': 'MindsHub', 'openai-compatible': 'OpenAI-compatible' },
  ...(gate === undefined ? {} : { gate }),
});
const MINDS = { type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' };
const COMPAT = { type: 'openai-compatible', apiKey: '', baseUrl: 'http://localhost:11434/v1' };

function Harness({ initial }) {
  const [settings, setSettings] = useState(initial);
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
      serverBusy={false}
      onStartServer={vi.fn()}
      onStopServer={vi.fn()}
      section="agent"
      onSectionChange={vi.fn()}
      isSsoConnected={false}
      onSsoSignIn={vi.fn()}
      shellUpdate={null}
      onDownloadShellUpdate={vi.fn()}
    />
  );
}

describe('router role row — the copy follows what the server reports (ENG-1851)', () => {
  it('keeps one stable title whatever the provider', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, undefined)} />);
    expect(await screen.findByText('Routing and summarization model')).toBeInTheDocument();
  });

  it('with no gate reported (older server), describes that server: the gate runs on the pick', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, undefined)} />);
    expect(await screen.findByText(/respond-or-delegate gating on each turn, and history summarization/)).toBeInTheDocument();
  });

  it('shows the model the server says gates, not a rule about the provider', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS,
      { provider: 'minds-cloud', model: 'mindshub_air', followsRouterPick: false })} />);
    expect(await screen.findByText(/runs on mindshub_air, not on this pick/)).toBeInTheDocument();
  });

  it('on openai-compatible the server says the gate follows the pick, so the row says to pick for speed', async () => {
    render(<Harness initial={settingsFor('openai-compatible', COMPAT,
      { provider: 'openai-compatible', model: 'my-fast-model', followsRouterPick: true })} />);
    expect(await screen.findByText(/pick your fastest model here, not your smartest/)).toBeInTheDocument();
  });
});
