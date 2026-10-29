import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// Jev routing: the "Fast answers with Jev" switch, and the router row it makes redundant.

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
}));
vi.mock('../../../platform/host', () => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '1.2.3', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

const MINDS = { type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' };
const COMPAT = { type: 'openai-compatible', apiKey: '', baseUrl: 'http://localhost:11434/v1' };

const settingsFor = (type, card, extra = {}) => ({
  modelMode: 'default',
  planningProvider: type,
  codingProvider: type,
  routerProvider: type,
  providers: [card],
  providerStatus: { [type]: 'ok' },
  providerTypeLabels: { 'minds-cloud': 'MindsHub', 'openai-compatible': 'OpenAI-compatible' },
  // The switch sits in Advanced Settings, which needs the budget settings.
  maxToolRounds: 50,
  maxContinuations: 3,
  ...extra,
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

const ROUTER_ROW = 'Routing and summarization model';
const SWITCH = 'Fast answers with Jev';
const expandAdvanced = async () => fireEvent.click(await screen.findByRole('button', { name: 'Advanced Settings' }));

describe('the router row', () => {
  it('is hidden once the server routes with a decision model', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode: 'jev' } })} />);
    expect(await screen.findByText('Planning model')).toBeInTheDocument();
    expect(screen.queryByText(ROUTER_ROW)).toBeNull();
  });

  it('stays on openai-compatible, where its pick is the only router model', async () => {
    render(<Harness initial={settingsFor('openai-compatible', COMPAT, { routing: { mode: 'llm' } })} />);
    expect(await screen.findByText(ROUTER_ROW)).toBeInTheDocument();
  });

  it('stays on an older server, which still gates on it', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS)} />);
    expect(await screen.findByText(ROUTER_ROW)).toBeInTheDocument();
  });
});

describe('the Fast answers with Jev switch', () => {
  it.each([
    ['an older server', undefined],
    ['another provider', { mode: 'llm' }],
    ["an org's own decision model", { mode: 'own' }],
    ['zero data retention', { mode: 'zdr' }],
  ])('is absent on %s, where it would change nothing', async (_name, routing) => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing })} />);
    await expandAdvanced();
    expect(screen.getByText('Max steps per task')).toBeInTheDocument();
    expect(screen.queryByLabelText(SWITCH)).toBeNull();
  });

  it('is replaced by an Off line under zero data retention', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode: 'zdr' }, jevDecisionsEnabled: true })} />);
    await expandAdvanced();

    expect(screen.queryByLabelText(SWITCH)).toBeNull();
    expect(screen.getByTestId('jev-zdr-off')).toHaveTextContent('Off');
    expect(screen.getByText(/your organization has zero data retention/)).toBeInTheDocument();
  });

  it('shows off once the organization turned Jev off', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode: 'off' }, jevDecisionsEnabled: false })} />);
    await expandAdvanced();
    expect(screen.getByLabelText(SWITCH)).not.toBeChecked();
  });

  it('saves turning Jev off', async () => {
    const onSave = vi.fn(async () => {});
    render(<SettingsView
      settings={settingsFor('minds-cloud', MINDS, { routing: { mode: 'jev' } })}
      setSetting={vi.fn()} onSave={onSave}
      theme="dark" onThemeChange={vi.fn()} skin="default" onSkinChange={vi.fn()}
      customTheme={{}} onCustomThemeChange={vi.fn()} agentLabel="Anton"
      section="agent" onSectionChange={vi.fn()} shellUpdate={null} onDownloadShellUpdate={vi.fn()}
    />);
    await expandAdvanced();
    expect(screen.getByLabelText(SWITCH)).toBeChecked();

    fireEvent.click(screen.getByLabelText(SWITCH));
    fireEvent.click(await screen.findByRole('button', { name: /^Save settings$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave.mock.calls.at(-1)[0]).toMatchObject({ jevDecisionsEnabled: false });
  });
});
