import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// The first dropdown open must recheck the wallet despite the freshness window, so external top-ups
// appear without restart.

const spies = vi.hoisted(() => ({
  testProviders: vi.fn(async () => ({ providerStatus: { 'minds-cloud': 'ok' }, providerStatusDetails: {} })),
  fetchRecommendedModels: vi.fn(async () => ({})),
}));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: spies.fetchRecommendedModels,
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
  providerStatus: { 'minds-cloud': 'ok' },
  providerStatusDetails: {},
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
  planningModel: 'sonnet',
  codingModel: 'sonnet',
  recommendedModels: { 'minds-cloud': ['sonnet', 'opus'] },
  recommendedPair: { 'minds-cloud': ['sonnet', 'sonnet', 'sonnet'] },
  modelLabels: { sonnet: 'Claude Sonnet 5', opus: 'Claude Opus 5' },
});

describe('SettingsView model dropdown — on-open refresh', () => {
  beforeEach(() => {
    spies.fetchRecommendedModels.mockClear();
  });

  it('refreshes on the first open of the session', async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={baseSettings()} />);

    await user.click(screen.getByTitle(/Pick the model used for planning/));

    await waitFor(() => expect(spies.fetchRecommendedModels).toHaveBeenCalledWith({ refresh: true }));
  });
});
