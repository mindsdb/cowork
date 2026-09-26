/* A model an org admin's rule blocks arrives as `enabled: false`, the same as
   one the wallet cannot pay for. Settings used to tag both "Needs credits" and
   send both to billing, where money cannot lift an admin rule. With the
   reason relayed in `modelDisabledReasons`, the restricted model says an admin
   restricted it and offers no billing route. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  resetDeviceIdentity: vi.fn(),
  trackBillingOpened: vi.fn(),
}));
vi.mock('../../lib/analytics', () => analyticsMock);
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

const settingsWith = (over) => ({
  modelMode: 'default',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
  recommendedModels: { 'minds-cloud': ['gpt-5.6-sol', 'air', 'opus'] },
  modelLabels: { 'gpt-5.6-sol': 'GPT-5.6 Sol', air: 'MindsHub Air', opus: 'Claude Opus 5' },
  planningProvider: 'minds-cloud',
  planningModel: 'gpt-5.6-sol',
  providerStatus: { 'minds-cloud': 'ok' },
  providerStatusDetails: {},
  ...over,
});

beforeEach(() => {
  analyticsMock.trackBillingOpened.mockClear();
  spies.testProviders.mockReset().mockResolvedValue({});
});

describe('SettingsView: a model an admin restricted', () => {
  it('names the admin restriction under the current model, with no billing link', async () => {
    render(<Harness initialSettings={settingsWith({
      modelEnabled: { 'gpt-5.6-sol': false },
      modelDisabledReasons: { 'gpt-5.6-sol': 'model_restricted' },
    })} />);

    await waitFor(() => expect(
      screen.getAllByText('GPT-5.6 Sol is restricted by an admin in your organization. Choose another model.').length,
    ).toBeGreaterThan(0));
    expect(screen.queryByText(/needs credits/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Top up your balance' })).toBeNull();
  });

  it('keeps the credits hint for a current model the wallet closes', async () => {
    render(<Harness initialSettings={settingsWith({
      modelEnabled: { 'gpt-5.6-sol': false },
      modelDisabledReasons: { 'gpt-5.6-sol': 'wallet_empty' },
    })} />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Top up your balance' }).length).toBeGreaterThan(0));
    expect(screen.queryByText(/is restricted by an admin/)).toBeNull();
  });

  it('tags a restricted row in the picker without an Add credits button', async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={settingsWith({
      modelEnabled: { 'gpt-5.6-sol': true, opus: false },
      modelDisabledReasons: { opus: 'model_restricted' },
    })} />);

    await user.click(screen.getByTitle(/Pick the model used for planning/));
    const row = await screen.findByRole('option', { name: /Claude Opus 5/ });
    expect(row).toHaveTextContent('Restricted');
    expect(row).not.toHaveTextContent('Needs credits');
    expect(row).toHaveAttribute('title', 'An admin in your organization restricted this model.');
    expect(within(row).queryByRole('button', { name: 'Add credits' })).toBeNull();
  });
});
