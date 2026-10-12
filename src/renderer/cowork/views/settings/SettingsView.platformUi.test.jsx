import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false, getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div>Channels</div> }));

import SettingsView, { MindsProbeNotice, UnavailableModelHint } from './SettingsView';
import { navItemsForHost } from './settingsNavigation';

const minds = { type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' };
const local = { type: 'openai-compatible', apiKey: '***', baseUrl: 'http://localhost:11434/v1', name: 'Local endpoint' };
const settings = {
  providers: [minds, local], mindsApiKey: '***', mindsUrl: minds.mindsUrl,
  openaiBaseUrl: local.baseUrl, planningProvider: 'openai-compatible', codingProvider: 'openai-compatible',
  planningModel: 'local-model', codingModel: 'local-model', modelMode: 'default', configReady: true,
  recommendedModels: { 'openai-compatible': ['local-model'] },
};

function renderSettings(data = settings, onSave = vi.fn(async () => ({})), section = 'agent') {
  return render(<SettingsView
    settings={data} onSave={onSave} theme="dark" skin="default" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section={section} onSectionChange={vi.fn()}
  />);
}

it('offers Agent, Appearance and Channels and rejects an old Usage deep link', () => {
  expect(navItemsForHost(true, true, true).map(({ id }) => id)).toEqual(['agent', 'appearance', 'channels']);
  renderSettings(settings, undefined, 'usage');
  expect(screen.getByRole('heading', { name: 'Local endpoint' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Usage' })).not.toBeInTheDocument();
});

it('shows the configured endpoint, hides platform acquisition, and preserves its hidden publishing credential on save', async () => {
  const save = vi.fn(async () => ({}));
  renderSettings(settings, save);
  expect(screen.getByRole('heading', { name: 'Local endpoint' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'MindsHub' })).not.toBeInTheDocument();
  expect(screen.queryByText(/All frontier models/)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Sign up/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Custom provider name' }), { target: { value: 'Renamed local' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].providers).toEqual([minds, { ...local, name: 'Renamed local' }]);
});

it('keeps a MindsHub inference card without signup or console links', () => {
  renderSettings({ ...settings, openaiBaseUrl: 'https://api.mindshub.ai/v1', planningProvider: 'minds-cloud' });
  expect(screen.getByRole('heading', { name: 'MindsHub' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Sign up|mindshub/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/All frontier models/)).not.toBeInTheDocument();
});

it('does not inject a MindsHub card into empty settings', () => {
  renderSettings({});
  expect(screen.queryByRole('heading', { name: 'MindsHub' })).not.toBeInTheDocument();
});

it.each(['no_credits', 'allowance_used', 'paused', 'slow_down', 'billing_unavailable'])('keeps provider refusals neutral: %s', (kind) => {
  render(<><MindsProbeNotice notice={{ kind }} /><UnavailableModelHint label="Configured model" /></>);
  expect(screen.getByText(/configured provider is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Configured model is unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText(/MindsHub|credits|allowance|funds|balance/i)).not.toBeInTheDocument();
});
