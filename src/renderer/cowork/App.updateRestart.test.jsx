import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updates = vi.hoisted(() => ({ ota: null, shell: null }));
const install = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

// Exercise App and useAppUpdates with the real update subscription boundary.
vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: false,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: (cb) => { updates.ota = cb; return () => { updates.ota = null; }; },
      onShellAutoUpdate: (cb) => { updates.shell = cb; return () => { updates.shell = null; }; },
      getShellAutoUpdate: vi.fn(async () => null),
      installShellAutoUpdate: install,
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

// Keep the bridge-dependent coding workspace inactive in this App wiring test.
vi.mock('./code/codeModeAccess', async (importOriginal) => ({
  ...(await importOriginal()),
  useCodeModeAccess: () => ({ available: true, enabled: false, state: 'disabled', setEnabled: () => {} }),
}));
vi.mock('./code/CodeView', () => ({ default: () => null }));
vi.mock('./code/useCodeModeLifecycle', () => ({ useCodeModeLifecycle: () => {} }));

// Keep the Settings content small while retaining App's real modal and handler.
vi.mock('./views/settings/SettingsView', () => ({
  default: ({ onInstallShellAutoUpdate }) => (
    <button onClick={onInstallShellAutoUpdate}>Restart now</button>
  ),
}));

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';
import { guardRestart, resetRestartConfirmationForTests } from '../platform/restart-guard';
import RestartConfirmHost from '../RestartConfirmHost';

beforeEach(() => {
  __resetDraftsForTests();
  resetRestartConfirmationForTests();
  install.mockReset();
});

async function openSettings() {
  const user = userEvent.setup();
  render(<><App /><RestartConfirmHost /></>);
  await screen.findByRole('button', { name: 'Display settings' });
  await user.click(await screen.findByRole('button', { name: /^(Open )?Settings$/ }));
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  return user;
}

describe('App closes Settings when a restart proceeds', () => {
  it.each([
    ['ota', 'downloading'],
    ['ota', 'reloading'],
    ['shell', 'installing'],
  ])('closes the modal on a pushed %s %s state', async (channel, phase) => {
    await openSettings();
    act(() => updates[channel]({ phase }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument());
  });

  it('keeps Settings open during a background shell download', async () => {
    await openSettings();
    act(() => updates.shell({ phase: 'downloading', progress: { percent: 42 } }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('keeps Settings open when the running-tasks restart is cancelled', async () => {
    const main = vi.fn(async () => ({ confirm: true, runningTasks: 2 }));
    install.mockImplementation(() => guardRestart(main));
    const user = await openSettings();
    act(() => updates.shell({ phase: 'ready-to-install' }));
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(await screen.findByText('Stop 2 running tasks and restart?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() => expect(screen.queryByText('Stop 2 running tasks and restart?')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(main).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalledWith({ force: true });
  });
});
