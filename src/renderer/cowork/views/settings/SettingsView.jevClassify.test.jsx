import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// The "Use Jev for classification" switch: on by default on MindsHub, off and
// locked on any other coding provider, absent on a server without the setting.

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
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
const SWITCH = 'Use Jev for classification';

const settingsFor = (type, card, extra = {}) => ({
  modelMode: 'default',
  planningProvider: type,
  codingProvider: type,
  routerProvider: type,
  providers: [card],
  providerStatus: { [type]: 'ok' },
  providerTypeLabels: { 'minds-cloud': 'MindsHub', 'openai-compatible': 'OpenAI-compatible' },
  maxToolRounds: 50,
  maxContinuations: 3,
  routing: { mode: 'jev' },
  ...extra,
});

const props = {
  onSave: vi.fn(async () => {}), theme: 'dark', onThemeChange: vi.fn(), skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(), agentLabel: 'Anton', section: 'agent', onSectionChange: vi.fn(),
  shellUpdate: null, onDownloadShellUpdate: vi.fn(),
};

function Harness({ initial }) {
  const [settings, setSettings] = useState(initial);
  return <SettingsView {...props} settings={settings} setSetting={(k, v) => setSettings((s) => ({ ...s, [k]: v }))} />;
}

const expandAdvanced = async () => fireEvent.click(await screen.findByRole('button', { name: 'Advanced Settings' }));

describe('the Use Jev for classification switch', () => {
  it('is on by default and follows the Jev switch in Advanced Settings on MindsHub', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS, { jevClassifyEnabled: true })} />);
    await expandAdvanced();
    const toggle = screen.getByLabelText(SWITCH);
    expect(toggle).toBeChecked();
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
    const jev = screen.getByLabelText('Fast answers with Jev');
    // Rendered right after "Fast answers with Jev".
    expect(jev.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is off and locked when the coding model is not on MindsHub', async () => {
    render(<Harness initial={settingsFor('openai-compatible', COMPAT, { routing: { mode: 'llm' }, jevClassifyEnabled: true })} />);
    await expandAdvanced();
    const toggle = screen.getByLabelText(SWITCH);
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Available only when the coding model runs on MindsHub.')).toBeInTheDocument();
  });

  it('is absent on a server without the setting', async () => {
    render(<Harness initial={settingsFor('minds-cloud', MINDS)} />);
    await expandAdvanced();
    expect(screen.getByLabelText('Fast answers with Jev')).toBeInTheDocument();
    expect(screen.queryByLabelText(SWITCH)).toBeNull();
  });

  it('saves turning it off', async () => {
    const onSave = vi.fn(async () => {});
    render(<SettingsView {...props} onSave={onSave} setSetting={vi.fn()}
      settings={settingsFor('minds-cloud', MINDS, { jevClassifyEnabled: true })} />);
    await expandAdvanced();
    fireEvent.click(screen.getByLabelText(SWITCH));
    fireEvent.click(await screen.findByRole('button', { name: /^Save settings$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls.at(-1)[0]).toMatchObject({ jevClassifyEnabled: false });
  });
});
