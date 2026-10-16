import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function renderSettings(initial, onSave = vi.fn(async () => ({})), props = {}) {
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
      {...props}
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

function setProviderTesting(value) {
  document.head.querySelectorAll('meta[name="cowork-provider-tests-enabled"]').forEach((node) => node.remove());
  if (value === undefined) return;
  const meta = document.createElement('meta');
  meta.name = 'cowork-provider-tests-enabled';
  meta.content = value;
  document.head.append(meta);
}

afterEach(() => setProviderTesting(undefined));

beforeEach(() => {
  setProviderTesting('false');
  mocks.deployment.PLATFORM_UI = false;
  mocks.host.isWeb = true;
  mocks.host.isElectron = false;
  mocks.testProviders.mockReset().mockResolvedValue({});
  mocks.validateSettings.mockReset().mockResolvedValue({ configReady: true });
});

describe.each(providers.flatMap((provider) => [false, true].map((platformUi) => ({
  provider, type: provider.type, platformUi,
}))))('disabled web provider tests: $type, platform UI $platformUi', ({ provider, platformUi }) => {
  beforeEach(() => { mocks.deployment.PLATFORM_UI = platformUi; });

  function expectSavedProviderEdit(received) {
    const expected = [{ ...provider, apiKey: 'updated-key' }];
    // Hosted Settings also includes its empty managed-provider row when saving BYOK.
    if (platformUi && provider.type !== 'minds-cloud') {
      expected.unshift(expect.objectContaining({ type: 'minds-cloud', apiKey: '' }));
    }
    expect(received).toEqual(expected);
  }

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
    expectSavedProviderEdit(onSave.mock.calls[0][0].providers);
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
    expectSavedProviderEdit(latest.current.providers);
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

it.each([false, true])('keeps a stored MindsHub rate limit neutral with testing disabled and platform UI %s', async (platformUi) => {
  mocks.deployment.PLATFORM_UI = platformUi;
  const provider = providers[1];
  const initial = settingsFor(provider, {
    providerStatus: { [provider.type]: 'fail' },
    providerStatusDetails: { [provider.type]: 'HTTP 429' },
    providerStatusReasons: { [provider.type]: { code: 'rate_limited' } },
  });
  const { latest } = renderSettings(initial);
  await act(async () => {});
  const neutral = 'The configured provider is unavailable. Try again, or contact your administrator.';
  const card = screen.getByRole('heading', { name: 'MindsHub' }).closest('.settings-provider-row');
  expect(within(card).getByText(neutral)).toBeInTheDocument();
  const router = screen.getByRole('heading', { name: 'Model Router' }).parentElement;
  expect(within(router).getAllByText(neutral).length).toBeGreaterThan(0);
  expect(screen.queryByText(/test again|re-test|run a test/i)).not.toBeInTheDocument();
  expect(latest.current.providerStatus).toEqual(initial.providerStatus);
  expect(latest.current.providerStatusReasons).toEqual(initial.providerStatusReasons);
  expectNoProviderCheck();
});

it.each([undefined, 'fail', 'ok'])('distinguishes SSO from recorded provider test status %s when tests are disabled', async (stored) => {
  mocks.deployment.PLATFORM_UI = true;
  const providerStatus = stored ? { 'minds-cloud': stored } : {};
  const { latest, setSetting } = renderSettings(
    settingsFor(providers[1], {
      providerStatus, providerStatusDetails: stored === 'fail' ? { 'minds-cloud': 'HTTP 401' } : {},
    }), undefined, { isSsoConnected: true },
  );
  await act(async () => {});
  if (stored === 'ok') {
    expect(screen.getByLabelText('Last test passed')).toBeInTheDocument();
  } else {
    expect(screen.getByLabelText('Connected through MindsHub sign-in.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Last test passed/)).not.toBeInTheDocument();
  }
  expectNoProviderCheck();
  expect(setSetting).not.toHaveBeenCalled();
  expect(latest.current.providerStatus).toEqual(providerStatus);
});

it('preserves enabled SSO testing and status copy', async () => {
  setProviderTesting(undefined);
  mocks.deployment.PLATFORM_UI = true;
  renderSettings(settingsFor(providers[1]), undefined, { isSsoConnected: true });
  await waitFor(() => expect(mocks.testProviders).toHaveBeenCalledExactlyOnceWith([providers[1]]));
  expect(screen.getByLabelText('Last test passed')).toBeInTheDocument();
});

it.each([
  { name: 'hosted web by default', isWeb: true, platformUi: true },
  { name: 'standalone web by default', isWeb: true, platformUi: false },
  { name: 'hosted web with explicit true', isWeb: true, platformUi: true, flag: 'true' },
  { name: 'standalone web with explicit true', isWeb: true, platformUi: false, flag: 'true' },
  { name: 'desktop', isWeb: false, platformUi: true, flag: 'false' },
  { name: 'desktop without platform UI', isWeb: false, platformUi: false, flag: 'false' },
])('preserves mount and dirty-save tests on $name', async ({ isWeb, platformUi, flag }) => {
  setProviderTesting(flag);
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
