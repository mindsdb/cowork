// ENG-1533: Settings holds two routes to the billing page, and they are not the
// same event to a reader. The no-credits notice follows a failed provider test
// (the wallet is empty right now); the locked-model hint follows picking a model
// the wallet cannot pay for (nothing is broken yet). Separate triggers, so the
// two are not read as one.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const spies = vi.hoisted(() => ({ testProviders: vi.fn(async () => ({})) }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: spies.testProviders,
}));

const hostMock = vi.hoisted(() => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../../platform/host', () => hostMock);

const analyticsMock = vi.hoisted(() => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
  trackBillingOpened: vi.fn(),
}));
vi.mock('../../lib/analytics', () => analyticsMock);
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { MINDS_BILLING_URL } from '../../../lib/mindsUrls';

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
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
  recommendedModels: { 'minds-cloud': ['gpt-5.6-sol', 'air'] },
  planningProvider: 'minds-cloud',
  planningModel: 'gpt-5.6-sol',
});

beforeEach(() => {
  analyticsMock.trackBillingOpened.mockClear();
  hostMock.host.openExternal.mockClear();
  spies.testProviders.mockReset().mockResolvedValue({});
});

describe('SettingsView — no-credits notice route (ENG-1533)', () => {
  const noCredits = () => ({
    ...baseSettings(),
    // A 429 in the provider-test detail is what flips isNoCredits on, rather
    // than the generic "failed its last test" warning.
    providerStatus: { 'minds-cloud': 'fail' },
    providerStatusDetails: { 'minds-cloud': 'HTTP 429' },
  });

  it('records trigger=no_credits_notice and opens billing', async () => {
    const user = userEvent.setup();
    spies.testProviders.mockResolvedValue({
      providerStatus: { 'minds-cloud': 'fail' },
      providerStatusDetails: { 'minds-cloud': 'HTTP 429' },
    });
    render(<Harness initialSettings={noCredits()} />);

    await waitFor(() => expect(screen.getAllByText(/No credits available/i).length).toBeGreaterThan(0));
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled(); // render is not a click

    await user.click(screen.getAllByRole('button', { name: /Top up balance/ })[0]);

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('no_credits_notice');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });
});

describe('SettingsView — locked-model hint route (ENG-1533)', () => {
  const lockedModel = () => ({
    ...baseSettings(),
    providerStatus: { 'minds-cloud': 'ok' },
    providerStatusDetails: {},
    // The selected model is listed by MindsHub as unpayable. Its row is closed
    // off, and because it is the CURRENT model the top-up hint renders under the
    // picker — the stranded-pin case, which is the only one that hint covers.
    modelEnabled: { 'gpt-5.6-sol': false },
  });

  it('records trigger=locked_model_hint, distinct from the no-credits notice', async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={lockedModel()} />);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Top up your balance' }).length).toBeGreaterThan(0),
    );
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: 'Top up your balance' })[0]);

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('locked_model_hint');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('shows no hint, and records nothing, when the model is payable', async () => {
    render(<Harness initialSettings={{ ...lockedModel(), modelEnabled: { 'gpt-5.6-sol': true } }} />);

    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Top up your balance' })).toBeNull();
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });
});
