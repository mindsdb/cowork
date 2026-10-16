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
  maxToolRounds: '50', maxContinuations: '5', actFirst: true,
};

function renderSettings(data = settings, onSave = vi.fn(async () => ({})), section = 'agent') {
  return render(<SettingsView
    settings={data} setSetting={vi.fn()} onSave={onSave} theme="dark" skin="default" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section={section} onSectionChange={vi.fn()}
  />);
}

it('offers Agent, Appearance and Channels and rejects an old Usage deep link', () => {
  expect(navItemsForHost(true, true, true).map(({ id }) => id)).toEqual(['agent', 'appearance', 'channels']);
  renderSettings(settings, undefined, 'usage');
  expect(screen.getByRole('heading', { name: 'Memory', exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Usage' })).not.toBeInTheDocument();
});

it.each([
  ['local inference with a publishing credential', settings],
  ['MindsHub inference', {
    ...settings, providers: [minds], openaiBaseUrl: 'https://api.mindshub.ai/v1',
    planningProvider: 'minds-cloud', codingProvider: 'minds-cloud', routerProvider: 'minds-cloud',
  }],
  ['empty providers', { ...settings, providers: [] }],
])('hides provider and model settings but keeps Memory and Advanced Settings with %s', (_name, data) => {
  const save = vi.fn();
  renderSettings(data, save);
  expect(screen.queryByRole('heading', { name: 'LLM Providers' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Model Router' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Local endpoint' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'MindsHub' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Custom provider name')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Sign up|mindshub/i })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Memory', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Act first, ask later' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Advanced Settings' })).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('saves a retained setting without changing hidden providers or models', async () => {
  const save = vi.fn(async () => ({}));
  renderSettings(settings, save);
  fireEvent.click(screen.getByRole('switch', { name: 'Act first, ask later' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith({ actFirst: false });
});

it.each(['no_credits', 'allowance_used', 'paused', 'slow_down', 'billing_unavailable'])('keeps provider refusals neutral: %s', (kind) => {
  render(<><MindsProbeNotice notice={{ kind }} /><UnavailableModelHint label="Configured model" /></>);
  expect(screen.getByText(/configured provider is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Configured model is unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText(/MindsHub|credits|allowance|funds|balance/i)).not.toBeInTheDocument();
});

it('keeps "Show where figures came from" in Appearance on a build without the platform UI', () => {
  renderSettings({ ...settings, showFigureSources: true }, undefined, 'appearance');
  expect(screen.getByLabelText('Show where figures came from')).toBeChecked();
});
