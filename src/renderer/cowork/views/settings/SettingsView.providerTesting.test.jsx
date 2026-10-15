import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deployment: { PLATFORM_UI: false },
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn() },
  testProviders: vi.fn(),
  validateSettings: vi.fn(),
}));

vi.mock('../../../lib/deployment', () => mocks.deployment);
vi.mock('../../../platform/host', () => ({
  host: mocks.host,
  get isElectron() { return mocks.host.isElectron; },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: mocks.validateSettings,
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: mocks.testProviders,
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div>Channels</div> }));

import SettingsView from './SettingsView';

const providers = [
  { type: 'openai-compatible', apiKey: '***', baseUrl: 'http://localhost:11434/v1', name: 'Local endpoint' },
  { type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' },
];

function settingsFor(provider, extra = {}) {
  return {
    providers: [provider],
    planningProvider: provider.type,
    codingProvider: provider.type,
    routerProvider: provider.type,
    planningModel: 'configured-model',
    codingModel: 'configured-model',
    routerModel: 'configured-model',
    modelMode: 'default',
    configReady: true,
    providerStatus: {},
    providerStatusDetails: {},
    providerStatusReasons: {},
    recommendedModels: { [provider.type]: ['configured-model'] },
    ...extra,
  };
}

function renderSettings(initial, onSave = vi.fn(async () => ({}))) {
  const latest = { current: initial };
  const setSetting = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(initial);
    latest.current = settings;
    return <SettingsView
      settings={settings}
      setSetting={(key, value) => {
        setSetting(key, value);
        setSettings((prev) => ({ ...prev, [key]: value }));
      }}
      onSave={async (patch) => {
        const result = await onSave(patch);
        setSettings((prev) => ({ ...prev, ...(result?.settings || patch) }));
        return result;
      }}
      theme="dark" skin="default" customTheme={{}}
      onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
      agentLabel="Cowork" serverOnline section="agent" onSectionChange={vi.fn()}
    />;
  }
  const view = render(<Harness />);
  return { ...view, latest, onSave, setSetting };
}

function editKey(provider) {
  const name = provider.type === 'minds-cloud' ? 'minds' : provider.type;
  fireEvent.change(screen.getByLabelText(`${name} API key`), { target: { value: 'updated-key' } });
}

function expectNoProviderCheck() {
  expect(mocks.testProviders).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Testing…')).not.toBeInTheDocument();
  expect(screen.queryByText(/^Checking .+ connection/)).not.toBeInTheDocument();
}

beforeEach(() => {
  mocks.deployment.PLATFORM_UI = false;
  mocks.host.isWeb = true;
  mocks.host.isElectron = false;
  mocks.testProviders.mockReset().mockResolvedValue({});
  mocks.validateSettings.mockReset().mockResolvedValue({ configReady: true });
});

describe.each(providers)('standalone web provider tests: $type', (provider) => {
  it('opens configured settings without testing or inventing a provider result', async () => {
    const { latest, setSetting } = renderSettings(settingsFor(provider));
    await act(async () => {});
    expectNoProviderCheck();
    expect(setSetting).not.toHaveBeenCalled();
    expect(latest.current.providerStatus).toEqual({});
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('saves a provider edit and validates configuration without a provider test', async () => {
    const user = userEvent.setup();
    const { latest, onSave, setSetting } = renderSettings(settingsFor(provider));
    editKey(provider);
    setSetting.mockClear();
    const saveButton = screen.getByRole('button', { name: 'Save settings' });
    await user.hover(saveButton);
    expect(await screen.findByText('Save changes.')).toBeInTheDocument();
    await user.click(saveButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].providers).toEqual([{ ...provider, apiKey: 'updated-key' }]);
    expect(mocks.validateSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Settings saved.');
    expect(screen.queryByText(/Test passed/)).not.toBeInTheDocument();
    expectNoProviderCheck();
    expect(setSetting).not.toHaveBeenCalled();
    expect(latest.current.providerStatus).toEqual({});
  });

  it('retains a rejected edit without validating or testing it', async () => {
    const onSave = vi.fn(async () => { throw new Error('Settings could not be saved.'); });
    const { latest } = renderSettings(settingsFor(provider), onSave);
    editKey(provider);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await screen.findByText('Settings could not be saved.');
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    expect(latest.current.providers).toEqual([provider]);
    expect(mocks.validateSettings).not.toHaveBeenCalled();
    expectNoProviderCheck();
  });

  it('reports failed validation while keeping the accepted edit', async () => {
    mocks.validateSettings.mockRejectedValue(new Error('Configuration unavailable.'));
    const { latest } = renderSettings(settingsFor(provider));
    editKey(provider);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await screen.findByText('Settings saved, but verification failed: Configuration unavailable.');
    expect(latest.current.providers).toEqual([{ ...provider, apiKey: 'updated-key' }]);
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expectNoProviderCheck();
  });

  it('keeps a stored failure without a pending check or an unusable retry action', async () => {
    let finishSave;
    const onSave = vi.fn(() => new Promise((resolve) => { finishSave = resolve; }));
    const initial = settingsFor(provider, {
      providerStatus: { [provider.type]: 'fail' },
      providerStatusDetails: { [provider.type]: 'HTTP 401' },
    });
    const { latest } = renderSettings(initial, onSave);
    await act(async () => {});
    expectNoProviderCheck();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('title', 'No unsaved changes');
    expect(latest.current.providerStatus).toEqual(initial.providerStatus);

    // Renaming preserves the failed status, unlike changing a key, which clears it.
    if (provider.type === 'openai-compatible') {
      fireEvent.change(screen.getByLabelText('Custom provider name'), { target: { value: 'Renamed endpoint' } });
    } else {
      fireEvent.click(screen.getByRole('switch', { name: 'Act first, ask later' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving settings…');
    expectNoProviderCheck();
    await act(async () => finishSave({}));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(latest.current.providerStatus).toEqual(initial.providerStatus);
    expectNoProviderCheck();
  });
});

it.each([
  { name: 'hosted web', isWeb: true, platformUi: true },
  { name: 'desktop', isWeb: false, platformUi: true },
  { name: 'desktop without platform UI', isWeb: false, platformUi: false },
])('preserves mount and dirty-save tests on $name', async ({ isWeb, platformUi }) => {
  mocks.host.isWeb = isWeb;
  mocks.host.isElectron = !isWeb;
  mocks.deployment.PLATFORM_UI = platformUi;
  const provider = providers[0];
  renderSettings(settingsFor(provider));
  await waitFor(() => expect(mocks.testProviders).toHaveBeenCalledExactlyOnceWith([provider]));

  editKey(provider);
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(mocks.testProviders).toHaveBeenCalledTimes(2));
  expect(mocks.testProviders).toHaveBeenLastCalledWith([{ ...provider, apiKey: 'updated-key' }]);
  expect(mocks.validateSettings).toHaveBeenCalledOnce();
  expect(screen.getByRole('status')).toHaveTextContent('Test passed — provider, model, and credentials look good.');
});
