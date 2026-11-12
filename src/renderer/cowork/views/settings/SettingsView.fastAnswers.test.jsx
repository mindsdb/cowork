import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// Jev routing: the "Fast answers with Jev" switch, and the router row it makes redundant.

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
  testDecisionModel: vi.fn(async () => ({ ok: true, error: null, ms: 1 })),
}));
const host = vi.hoisted(() => ({ isElectron: true, isWeb: false, isMac: () => false, openExternal: () => {} }));
vi.mock('../../../platform/host', () => ({
  host,
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

afterEach(() => { host.isWeb = false; });

describe('the router row', () => {
  it('is hidden once the server routes with a decision model', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode: 'jev' } })} />);
    expect(await screen.findByText('Planning model')).toBeInTheDocument();
    expect(screen.queryByText(ROUTER_ROW)).toBeNull();
  });

  it('stays on openai-compatible, where its pick is the only router model', async () => {
    render(<Harness initial={settingsFor('openai-compatible', COMPAT, { routing: { mode: 'llm', routerProvider: 'openai-compatible' } })} />);
    expect(await screen.findByText(ROUTER_ROW)).toBeInTheDocument();
  });

  it("follows the server's resolution, not the stored provider", async () => {
    // Stored on MindsHub with no key; the server resolved the role to the
    // org's openai-compatible endpoint, whose gate runs on this pick.
    render(<Harness initial={settingsFor('minds-cloud', MINDS, {
      routing: { mode: 'llm', routerProvider: 'openai-compatible' },
      gate: { provider: 'openai-compatible', model: 'llama', followsRouterPick: true },
    })} />);
    expect(await screen.findByText(ROUTER_ROW)).toBeInTheDocument();
  });

  it('stays on an older server, which still gates on it', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS)} />);
    expect(await screen.findByText(ROUTER_ROW)).toBeInTheDocument();
  });
});

describe('the Fast answers with Jev switch', () => {
  it.each([
    ['an older server', 'minds-cloud', MINDS, undefined],
    ['another provider', 'openai-compatible', COMPAT, { mode: 'llm' }],
    ["an org's own decision model off MindsHub", 'openai-compatible', COMPAT, { mode: 'own' }],
  ])('is absent on %s, where it would change nothing', async (_name, type, card, routing) => {
    render(<Harness initial={settingsFor(type, card, { routing })} />);
    await expandAdvanced();
    expect(screen.getByText('Max steps per task')).toBeInTheDocument();
    expect(screen.queryByLabelText(SWITCH)).toBeNull();
  });

  it.each([['the LLM gate', 'llm'], ["an org's own decision model", 'own']])(
    'shows with %s when coding runs on MindsHub, for the completion check', async (_name, mode) => {
      render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode } })} />);
      await expandAdvanced();
      expect(screen.getByLabelText(SWITCH)).toBeChecked();
    },
  );

  it('shows on a server that sends no budget settings', async () => {
    const { maxToolRounds: _r, maxContinuations: _c, ...noBudgets } = settingsFor('minds-cloud', MINDS, { routing: { mode: 'jev' } });
    render(<Harness initial={noBudgets} />);
    await expandAdvanced();
    expect(screen.getByLabelText(SWITCH)).toBeChecked();
    expect(screen.queryByText('Max steps per task')).toBeNull();
  });

  it('shows beside the budget rows on hosted web', async () => {
    host.isWeb = true;
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode: 'jev' } })} />);
    await expandAdvanced();
    expect(screen.getByLabelText(SWITCH)).toBeChecked();
    expect(screen.getByText('Max steps per task')).toBeInTheDocument();
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

describe('the Decision model group', () => {
  it('signed in to MindsHub, is just Jev in the Model router card, with no fields', async () => {
    for (const routing of [undefined, { mode: 'jev' }, { mode: 'jev', canSetDecisionModel: true }]) {
      const { unmount } = render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing })} />);
      expect(await screen.findByText('Planning model')).toBeInTheDocument();
      expect(screen.getByText('Decision model')).toBeInTheDocument();
      expect(screen.getByText('Jev')).toBeInTheDocument();
      expect(screen.queryByLabelText('Endpoint URL')).toBeNull();
      unmount();
    }
  });

  it('without MindsHub, is absent for whoever may not change the provider, and on an older server', async () => {
    const local = { ...COMPAT, name: 'Local' };
    for (const routing of [undefined, { mode: 'llm' }, { mode: 'llm', canSetDecisionModel: false }]) {
      const { unmount } = render(<Harness initial={settingsFor('openai-compatible', local, { routing })} />);
      expect(await screen.findByText('Planning model')).toBeInTheDocument();
      expect(screen.queryByText('Decision model')).toBeNull();
      unmount();
    }
  });

  it('sits with the provider settings, and its fields save with the form', async () => {
    const onSave = vi.fn(async () => {});
    render(<SettingsView
      settings={settingsFor('openai-compatible', { ...COMPAT, name: 'Local' }, { routing: { mode: 'llm', routerProvider: 'openai-compatible', canSetDecisionModel: true } })}
      setSetting={vi.fn()} onSave={onSave}
      theme="dark" onThemeChange={vi.fn()} skin="default" onSkinChange={vi.fn()}
      customTheme={{}} onCustomThemeChange={vi.fn()} agentLabel="Anton"
      section="agent" onSectionChange={vi.fn()} shellUpdate={null} onDownloadShellUpdate={vi.fn()}
    />);
    expect(await screen.findByText('Decision model')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://decide.example.test/d' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'own-key' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save settings$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls.at(-1)[0]).toMatchObject({
      decisionModelUrl: 'https://decide.example.test/d', decisionModelApiKey: 'own-key',
    });
  });
});
