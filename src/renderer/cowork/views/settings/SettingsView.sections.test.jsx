import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// Behavior-lock: every Settings section must mount and render its defining
// content without throwing. This is the safety net for extracting the
// per-section panels out of SettingsView (starting with Updates) — a dropped
// prop or missing dependency turns into a failed render here rather than a
// silent regression in the app.

const spies = vi.hoisted(() => ({
  serverDiagnostics: vi.fn(async () => ({})),
  checkForUpdates: vi.fn(async () => ({ ok: true, updateAvailable: false })),
  applyUpdate: vi.fn(async () => false),
  getAccessToken: vi.fn(async () => ''),
  getVersionInfo: vi.fn(async () => ({ app: '1.2.3', ui: null, source: 'bundled' })),
}));
const codingSpies = vi.hoisted(() => ({
  engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
  terminalShells: vi.fn(async () => ({
    platform: 'darwin', resolved: 'bash', items: [
      { id: 'auto', label: 'Automatic — Bash' },
      { id: 'bash', label: 'Bash' },
    ],
  })),
}));
const deployment = vi.hoisted(() => ({ isWeb: false, orgMode: false }));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    get isWeb() { return deployment.isWeb; },
    codeModeAvailable: true,
    isMac: () => false,
    openExternal: vi.fn(),
    serverDiagnostics: spies.serverDiagnostics,
    checkForUpdates: spies.checkForUpdates,
    applyUpdate: spies.applyUpdate,
    onWindowVisibility: () => () => {},
  },
  getVersionInfo: spies.getVersionInfo,
  getCodeControlPlaneOrigin: () => 'https://code.example.test',
  isElectron: true,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../../../lib/orgMode', () => ({
  useOrgMode: () => deployment.orgMode,
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));
vi.mock('../../code/api', () => ({
  codingApi: {
    engines: codingSpies.engines,
    terminalShells: codingSpies.terminalShells,
    models: vi.fn(async () => ({ items: ['fable'] })),
    computers: vi.fn(async () => ({ items: [{
      schema_version: 1,
      id: 'local',
      name: 'This computer',
      is_local: true,
      status: 'online',
      active_run_count: 0,
      last_seen_at: new Date().toISOString(),
      capabilities: { platform: 'darwin', architecture: 'arm64', runtime_version: '1', protocol_versions: ['1.0'], agent_engines: ['codex'], shells: ['bash'], has_git: true, has_terminal: true, supports_local_folders: true, max_concurrent_runs: 4 },
    }] })),
    computerRegistrationToken: vi.fn(async () => ({ registration_token: 'test-token', expires_in_seconds: 600 })),
    renameComputer: vi.fn(),
    revokeComputer: vi.fn(),
  },
}));

import SettingsView from './SettingsView';

beforeEach(() => {
  window.localStorage.setItem('mindshub.code.enabled.v1', 'true');
  Object.values(codingSpies).forEach((spy) => spy.mockClear());
});

const baseSettings = () => ({
  modelMode: 'default',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
  providerStatus: { 'minds-cloud': 'ok' },
  providerStatusDetails: {},
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
});

function Harness({ section }) {
  const [settings, setSettings] = useState(baseSettings());
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
      section={section}
      onSectionChange={vi.fn()}
      isSsoConnected={false}
      onSsoSignIn={vi.fn()}
      shellUpdate={null}
      onDownloadShellUpdate={vi.fn()}
    />
  );
}

beforeEach(() => {
  deployment.isWeb = false;
  deployment.orgMode = false;
});

describe('SettingsView — every section mounts (behavior lock)', () => {
  beforeEach(() => {
    Object.values(spies).forEach((s) => s.mockClear());
  });

  it('renders the Agent section', async () => {
    render(<Harness section="agent" />);
    expect(await screen.findByText('LLM Providers')).toBeInTheDocument();
  });

  it('renders the independent Coding agent section', async () => {
    render(<Harness section="codingAgent" />);
    expect(await screen.findByText('The default coding agent for new projects and tasks. You can change it when starting a task.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Coding agent engine' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Coding agent model' })).toBeInTheDocument();
  });

  it('renders the Computers section with local and managed targets', async () => {
    render(<Harness section="computers" />);
    expect(await screen.findByText('Run Code beyond this computer')).toBeInTheDocument();
    expect(screen.getByText('Managed compute')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('creates a short-lived cross-platform computer connection command', async () => {
    const user = userEvent.setup();
    render(<Harness section="computers" />);

    await user.click(await screen.findByRole('button', { name: 'Connect computer' }));
    expect(await screen.findByRole('dialog', { name: 'Connect a computer' })).toBeInTheDocument();
    expect(await screen.findByText(/cowork-code-runtime --server "https:\/\/code\.example\.test"/)).toHaveTextContent('--code "test-token"');
    expect(screen.getByRole('combobox', { name: 'Computer type' })).toHaveTextContent('Mac');
    expect(screen.queryByText(/private local address/)).not.toBeInTheDocument();
  });

  it('renders the Appearance section', async () => {
    render(<Harness section="appearance" />);
    expect(await screen.findByText('Theme')).toBeInTheDocument();
  });

  it('renders the Channels section', async () => {
    render(<Harness section="channels" />);
    expect(await screen.findByTestId('channels-stub')).toBeInTheDocument();
  });

  it('renders the Updates section with the current version card', async () => {
    render(<Harness section="updates" />);
    expect(await screen.findByText('Current version')).toBeInTheDocument();
    expect(await screen.findByText('Software updates')).toBeInTheDocument();
    // The mount-time version + health reads fire when the panel is shown.
    expect(spies.getVersionInfo).toHaveBeenCalled();
  });

  it('renders the Backend section', async () => {
    render(<Harness section="backend" />);
    expect(await screen.findByText(/MindsHub backend is running/i)).toBeInTheDocument();
    expect(spies.serverDiagnostics).toHaveBeenCalled();
  });

  it('renders the Account section sign-in card when signed out', async () => {
    render(<Harness section="account" />);
    expect(await screen.findByText(/Sign in \/ Sign up to MindsHub/i)).toBeInTheDocument();
    expect(spies.getAccessToken).toHaveBeenCalled();
  });
});

describe('SettingsView — LLM provider visibility (ENG-2185)', () => {
  it('hides the entire provider-management card on SaaS Cowork', async () => {
    deployment.isWeb = true;
    deployment.orgMode = true;

    render(<Harness section="agent" />);

    expect(await screen.findByText('Model Router')).toBeInTheDocument();
    expect(screen.queryByText('LLM Providers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add provider' })).not.toBeInTheDocument();
  });

  it.each([
    ['standalone self-hosted web', true],
    ['desktop', false],
  ])('keeps provider management on %s', async (_deployment, isWeb) => {
    deployment.isWeb = isWeb;

    render(<Harness section="agent" />);

    expect(await screen.findByText('LLM Providers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeInTheDocument();
  });
});

describe('SettingsView — Code Mode opt-in', () => {
  it('shows only the local opt-in while disabled and performs no Code service reads', async () => {
    window.localStorage.setItem('mindshub.code.enabled.v1', 'false');
    render(<Harness section="codingAgent" />);

    expect(await screen.findByRole('switch', { name: 'Enable Code Mode' })).not.toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'Coding agent engine' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Coding agent model' })).toBeNull();
    expect(codingSpies.engines).not.toHaveBeenCalled();
    expect(codingSpies.terminalShells).not.toHaveBeenCalled();
  });

  it('reveals the complete settings surface immediately after opting in', async () => {
    window.localStorage.setItem('mindshub.code.enabled.v1', 'false');
    const user = userEvent.setup();
    render(<Harness section="codingAgent" />);

    await user.click(await screen.findByRole('switch', { name: 'Enable Code Mode' }));

    expect(await screen.findByRole('combobox', { name: 'Coding agent engine' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Coding agent model' })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Default terminal shell' })).toBeInTheDocument();
    expect(codingSpies.engines).toHaveBeenCalledOnce();
    expect(codingSpies.terminalShells).toHaveBeenCalledOnce();
  });
});
