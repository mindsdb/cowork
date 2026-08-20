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
    isWeb: false,
    // Coding Mode's own tests below need its nav section reachable; the
    // parked-by-default behavior (flag off) is covered separately in
    // SettingsView.hostGating.test.js.
    codingModeOptionsEnabled: true,
    isMac: () => false,
    openExternal: vi.fn(),
    serverDiagnostics: spies.serverDiagnostics,
    checkForUpdates: spies.checkForUpdates,
    applyUpdate: spies.applyUpdate,
  },
  getVersionInfo: spies.getVersionInfo,
  isElectron: true,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

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

describe('SettingsView — every section mounts (behavior lock)', () => {
  beforeEach(() => {
    Object.values(spies).forEach((s) => s.mockClear());
  });

  it('renders the Agent section', async () => {
    render(<Harness section="agent" />);
    expect(await screen.findByText('LLM Providers')).toBeInTheDocument();
  });

  it('renders the Coding Mode section', async () => {
    // Desktop (host.isWeb: false, mocked above) shows the "Coding Mode" nav
    // section — its own top-level entry, not part of Agent.
    render(<Harness section="codingMode" />);
    expect(await screen.findByText('Coding mode')).toBeInTheDocument();
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

// ─── Coding Mode's per-harness picker ──────────────────────────────────
//
// Desktop only (host.isWeb: false throughout this file), and its own
// top-level nav section (after Agent, before Appearance) rather than part
// of Agent. The top-level "Coding mode" switch lives in its own "Coding
// Mode" card; the per-harness enable toggles live in a separate "Available
// Agents" card below it — not hidden while Coding mode is off, just greyed
// out (disabled) so it's clear what turning it on unlocks. Anton is still
// listed there (so it's clear it's part of the picker) but has no Switch —
// it's the default agent and can't be turned off; Hermes specifically is
// hidden unless the server actually has it registered (settings.harnessOptions,
// from available_harness_ids()).

describe('SettingsView — Coding Mode harness picker', () => {
  it('shows the harness toggles disabled while Coding mode itself is off', async () => {
    render(<Harness section="codingMode" />);
    await screen.findByText('Coding mode');
    expect(screen.getByText('Available Agents')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /enable claude-code/i })).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables the Claude-Code toggle once Coding mode is switched on; Anton is listed but has no toggle', async () => {
    const user = userEvent.setup();
    render(<Harness section="codingMode" />);
    await user.click(await screen.findByRole('switch', { name: 'Coding mode' }));

    expect(screen.getByRole('switch', { name: /enable claude-code/i })).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Anton')).toBeInTheDocument();
    expect(screen.getByText('Always on')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /enable anton/i })).not.toBeInTheDocument();
  });

  it('hides Hermes when the server does not report it as available', async () => {
    render(<Harness section="codingMode" />);
    await screen.findByText('Coding mode');

    // baseSettings() carries no harnessOptions — server never reported
    // hermes-agent as installed.
    expect(screen.queryByRole('switch', { name: /enable hermes/i })).not.toBeInTheDocument();
  });

  it('shows Hermes when the server reports it as available', async () => {
    const user = userEvent.setup();
    function HermesHarness() {
      const [settings, setSettings] = useState({ ...baseSettings(), harnessOptions: ['anton', 'hermes'] });
      const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
      return (
        <SettingsView
          settings={settings} setSetting={setSetting} onSave={vi.fn(async () => {})}
          theme="dark" onThemeChange={vi.fn()} skin="default" onSkinChange={vi.fn()}
          customTheme={{}} onCustomThemeChange={vi.fn()} agentLabel="Anton"
          serverOnline serverBusy={false} onStartServer={vi.fn()} onStopServer={vi.fn()}
          section="codingMode" onSectionChange={vi.fn()} isSsoConnected={false} onSsoSignIn={vi.fn()}
          shellUpdate={null} onDownloadShellUpdate={vi.fn()}
        />
      );
    }
    render(<HermesHarness />);
    await user.click(await screen.findByRole('switch', { name: 'Coding mode' }));

    expect(screen.getByRole('switch', { name: /enable hermes/i })).toBeInTheDocument();
  });
});
