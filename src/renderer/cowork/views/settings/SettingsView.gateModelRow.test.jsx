import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';

// ENG-1851: the router role's row says what the pick governs.
//
// The pre-Anton respond-or-delegate gate runs on the provider's fast default
// and ignores the user's router pick, which only governs history
// summarization — except on openai-compatible, where no default exists and
// the user's model is the only one the gate can run on. The row's title and
// subtitle follow that split, so a user who picks a large model here is told
// what it does (and, on openai-compatible, why speed matters).

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

const mindsSettings = () => ({
  modelMode: 'default',
  planningProvider: 'minds-cloud',
  codingProvider: 'minds-cloud',
  routerProvider: 'minds-cloud',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' }],
  providerStatus: { 'minds-cloud': 'ok' },
  providerStatusDetails: {},
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
  recommendedPair: { 'minds-cloud': ['mindshub_air', 'mindshub_air', 'mindshub_air'] },
  recommendedModels: { 'minds-cloud': ['mindshub_air', 'sonnet'] },
  modelEnabled: { mindshub_air: true, sonnet: true },
});

const compatSettings = () => ({
  modelMode: 'default',
  planningProvider: 'openai-compatible',
  codingProvider: 'openai-compatible',
  routerProvider: 'openai-compatible',
  planningModel: 'my-model',
  codingModel: 'my-model',
  routerModel: 'my-fast-model',
  providers: [{ type: 'openai-compatible', apiKey: '', baseUrl: 'http://localhost:11434/v1' }],
  providerStatus: { 'openai-compatible': 'ok' },
  providerStatusDetails: {},
  providerTypeLabels: { 'openai-compatible': 'OpenAI-compatible' },
  recommendedPair: {},
  recommendedModels: { 'openai-compatible': ['my-model', 'my-fast-model'] },
  modelEnabled: {},
});

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

describe('router role row — what the pick governs (ENG-1851)', () => {
  it('on a provider with a fast default, the pick is a summarization pick', async () => {
    render(<Harness initial={mindsSettings()} />);
    expect(await screen.findByText('Summarization model')).toBeInTheDocument();
    expect(screen.getByText(/not affected by this pick/)).toBeInTheDocument();
    expect(screen.queryByText('Routing and summarization model')).toBeNull();
  });

  it('on openai-compatible, the pick also gates every turn and the row says to pick for speed', async () => {
    render(<Harness initial={compatSettings()} />);
    expect(await screen.findByText('Routing and summarization model')).toBeInTheDocument();
    expect(screen.getByText(/two-second budget/)).toBeInTheDocument();
    expect(screen.getByText(/fastest model here, not your smartest/)).toBeInTheDocument();
    expect(screen.queryByText('Summarization model')).toBeNull();
  });
});
