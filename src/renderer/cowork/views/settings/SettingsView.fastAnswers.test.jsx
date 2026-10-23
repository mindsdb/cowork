import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// Jev routing: the "Fast answers" group, and the router row it makes redundant.

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
const expandFastAnswers = () => fireEvent.click(screen.getByRole('button', { name: 'Fast answers' }));

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

describe('the Fast answers group', () => {
  it('is absent on a server that does not report routing', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS)} />);
    await screen.findByText('Planning model');
    expect(screen.queryByRole('button', { name: 'Fast answers' })).toBeNull();
  });

  it('starts collapsed, and says who decides', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { routing: { mode: 'off' } })} />);
    await screen.findByRole('button', { name: 'Fast answers' });
    expect(screen.queryByLabelText('Use Jev on MindsHub')).toBeNull();

    expandFastAnswers();

    expect(screen.getByTestId('routing-status')).toHaveTextContent(
      'Jev is off and no decision model is set, so every message runs Anton.',
    );
  });

  it('saves the Jev switch and the decision model fields', async () => {
    const onSave = vi.fn(async () => {});
    render(<SettingsView
      settings={settingsFor('minds-cloud', MINDS, { routing: { mode: 'jev' }, jevDecisionsEnabled: true })}
      setSetting={vi.fn()} onSave={onSave}
      theme="dark" onThemeChange={vi.fn()} skin="default" onSkinChange={vi.fn()}
      customTheme={{}} onCustomThemeChange={vi.fn()} agentLabel="Anton"
      section="agent" onSectionChange={vi.fn()} shellUpdate={null} onDownloadShellUpdate={vi.fn()}
    />);
    await screen.findByRole('button', { name: 'Fast answers' });
    expandFastAnswers();

    fireEvent.click(screen.getByLabelText('Use Jev on MindsHub'));
    fireEvent.change(screen.getByLabelText('Decision model endpoint'), {
      target: { value: 'https://api.typesafe.ai/v1/systemone' },
    });
    fireEvent.change(screen.getByLabelText('Decision model name'), { target: { value: 'jev-latest' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Save settings$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave.mock.calls.at(-1)[0]).toMatchObject({
      jevDecisionsEnabled: false,
      decisionModelUrl: 'https://api.typesafe.ai/v1/systemone',
      decisionModel: 'jev-latest',
    });
  });
});
