import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mutable so the Debian cases can flip the platform the card reads.
const platformMock = vi.hoisted(() => ({ value: 'darwin' }));

// The desktop Settings "Software updates" section is Electron-only and surfaces
// the shell (installer) reinstall notice + Download control (ENG-849). Stub the
// API/host/analytics/Channels deps SettingsView reaches for on mount so this
// stays focused on the shell-download path (regression: PR #453 review — the
// desktop SettingsView instance wasn't wired with the shell props).
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isMac: () => platformMock.value === 'darwin',
    getPlatform: () => platformMock.value,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    checkForUpdates: vi.fn(async () => ({ ok: true, offline: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false })),
    applyUpdate: vi.fn(async () => true),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.13.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { coordinateUpdates } from '../../../../shared/update-coordinator';

afterEach(() => { platformMock.value = 'darwin'; });
import { host } from '../../../platform/host';

const baseProps = {
  settings: {}, setSetting: vi.fn(), onSave: vi.fn(),
  theme: 'dark', onThemeChange: vi.fn(),
  skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(),
  agentLabel: 'Anton',
  section: 'updates',
  onSectionChange: vi.fn(),
};

// Every case renders from the one update state (src/shared/update-coordinator.ts)
// the way App.jsx hands it down, and routes the one action through a stub of
// useAppUpdates' handler.
const stateFor = (input) => coordinateUpdates({ shell: null, ota: null, server: null, shellManual: null, ...input });
const shell = (phase, over = {}) => ({ phase, mode: 'auto', channel: 'prod', currentVersion: '2.26.7.13.1', ...over });
const uiReady = { ota: { phase: 'available', version: '2.26.7.20.1', uiUpdate: true, uiVersion: '2.26.7.20.1', serverUpdate: false } };
const manualNotice = (over = {}) => ({ shellManual: { version: '2.26.7.20.1', currentVersion: '2.26.7.13.1', downloadUrl: 'https://x/y.pkg', ...over } });

describe('SettingsView desktop — shell reinstall download (ENG-849)', () => {
  it('renders the reinstall notice from a background poll and Downloads via the one action', () => {
    const onUpdateAction = vi.fn(async () => true);
    render(<SettingsView {...baseProps} updateState={stateFor(manualNotice())} onUpdateAction={onUpdateAction} />);
    expect(screen.getByText(/New version available \(2\.26\.7\.20\.1\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download installer/ }));
    // The action is the renderer's own, and carries the resolved installer URL.
    expect(onUpdateAction).toHaveBeenCalledWith('open-download-page', { url: 'https://x/y.pkg' });
    // After the hand-off to the browser download, the card guides the user
    // through the manual steps that download can't — quit + open the installer
    // — and the CTA de-emphasizes to a "Download again" retry.
    expect(screen.getByText(/Installer downloading/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download again/ })).toBeInTheDocument();
  });

  it('tells a Debian user to apt install the .deb, before and after the download', () => {
    platformMock.value = 'linux';
    render(<SettingsView {...baseProps} updateState={stateFor(manualNotice({ downloadUrl: 'https://d/linux-amd64/mindshub-cowork-latest.deb' }))} onUpdateAction={vi.fn(async () => true)} />);
    // "open it" does nothing on a desktop with no GUI handler for .deb, so the
    // card names the command that actually installs the package.
    const step = /run sudo apt install \.\/mindshub-cowork-2\.26\.7\.20\.1\*\.deb from the directory you downloaded it to\./;
    expect(screen.getByText(step)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download installer/ }));
    expect(screen.getByText(/Installer downloading/)).toBeInTheDocument();
    expect(screen.getByText(step)).toBeInTheDocument();
  });

  it('names apt on linux even when the old shell supplied no installer URL', () => {
    platformMock.value = 'linux';
    render(<SettingsView {...baseProps} updateState={stateFor(manualNotice({ downloadUrl: null }))} onUpdateAction={vi.fn()} />);
    expect(screen.getByText(/run sudo apt install \.\/mindshub-cowork-2\.26\.7\.20\.1\*\.deb/)).toBeInTheDocument();
  });

  it('keeps the "open it" guidance off linux', () => {
    render(<SettingsView {...baseProps} updateState={stateFor(manualNotice({ downloadUrl: 'https://d/mac/mindshub-cowork-latest.pkg' }))} onUpdateAction={vi.fn()} />);
    expect(screen.getByText(/quit MindsHub Cowork and open it to finish updating/)).toBeInTheDocument();
  });

  it('shows no reinstall notice when nothing is pending', () => {
    render(<SettingsView {...baseProps} updateState={stateFor({})} onUpdateAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Download installer/ })).toBeNull();
    expect(screen.queryByText(/Update ready/)).toBeNull();
  });
});

describe('SettingsView desktop — shell auto-update lifecycle (ENG-850)', () => {
  it('shows download progress without offering a conflicting manual reinstall', () => {
    render(
      <SettingsView
        {...baseProps}
        updateState={stateFor({ shell: shell('downloading', { targetVersion: '2.260720.1', progress: { transferred: 50, total: 100, percent: 50 } }), ...manualNotice() })}
        onUpdateAction={vi.fn()}
      />
    );
    expect(screen.getByText(/Downloading update \(50%\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('offers restart only after the verified download is ready, through the one action', () => {
    const onUpdateAction = vi.fn(async () => true);
    render(<SettingsView {...baseProps} updateState={stateFor({ shell: shell('ready-to-install', { targetVersion: '2.260720.1' }) })} onUpdateAction={onUpdateAction} />);
    expect(screen.getByText('Update ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(onUpdateAction).toHaveBeenCalledTimes(1);
    expect(onUpdateAction.mock.calls[0][0]).toBe('relaunch');
  });

  it('says why the last restart did not finish and offers Try again (ENG-3291)', () => {
    const onUpdateAction = vi.fn(async () => true);
    render(
      <SettingsView
        {...baseProps}
        updateState={stateFor({ shell: shell('ready-to-install', {
          targetVersion: '2.260720.1', recoverable: true, errorCode: 'update-request-failed', errorMessage: 'installer launch failed',
        }) })}
        onUpdateAction={onUpdateAction}
      />
    );
    expect(screen.getByText(/Last restart attempt failed: installer launch failed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restart now/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onUpdateAction.mock.calls[0][0]).toBe('relaunch');
  });

  it('a targetless shell failure does not hide the UI/server Restart, and is noted under it rather than as a second card', () => {
    // A failure with no targetVersion (rejected check / failed retry check)
    // must NOT suppress a valid OTA update — a shell feed outage would
    // otherwise hide the UI/server Restart. One card, one restart.
    render(
      <SettingsView
        {...baseProps}
        updateState={stateFor({ ...uiReady, shell: shell('failed', { recoverable: true, errorMessage: 'feed unreachable' }) })}
        onUpdateAction={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Restart now/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Restart|Retry|Download/ })).toHaveLength(1);
    expect(screen.getByText(/The last app update check failed \(feed unreachable\)/)).toBeInTheDocument();
  });

  it('a recoverable shell failure with a known target offers Retry, and nothing else', () => {
    const onUpdateAction = vi.fn(async () => true);
    render(<SettingsView {...baseProps} updateState={stateFor({ ...uiReady, shell: shell('failed', { recoverable: true, targetVersion: '2.260720.1' }) })} onUpdateAction={onUpdateAction} />);
    expect(screen.getByText('Update failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restart now/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onUpdateAction.mock.calls[0][0]).toBe('retry');
  });
});

describe('SettingsView desktop — UI/server updates framed as a restart', () => {
  it('presents a pending UI/server update as "Restart now", naming the layers, not the shell\'s download wording', () => {
    render(
      <SettingsView
        {...baseProps}
        updateState={stateFor({ ota: { phase: 'available', version: '2.26.7.20.1', uiUpdate: true, uiVersion: '2.26.7.20.1', serverUpdate: true, serverVersion: '0.26.7.20.1', serverComponent: 'anton-agent' } })}
        onUpdateAction={vi.fn()}
      />
    );
    // UI/server updates apply by restarting the app — reserve download/version
    // language for the shell reinstall path.
    expect(screen.getByRole('button', { name: /Restart now/ })).toBeInTheDocument();
    expect(screen.getByText(/Restart the app to apply it \(Agent → 0\.26\.7\.20\.1, UI → 2\.26\.7\.20\.1\)\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download installer/ })).toBeNull();
  });

  it('shows one restart while a shell update and an OTA are both pending (shell-first, no stacked cards)', () => {
    // A shell relaunch also applies the UI/server OTA at boot, so the separate
    // OTA card would be redundant. Only the shell surface shows — mirroring the
    // sidebar's single shell-first banner — and it names what the restart applies.
    const onUpdateAction = vi.fn(async () => true);
    render(<SettingsView {...baseProps} updateState={stateFor({ ...uiReady, shell: shell('ready-to-install', { targetVersion: '2.26.7.20.1' }) })} onUpdateAction={onUpdateAction} />);
    expect(screen.getAllByRole('button', { name: /Restart now/ })).toHaveLength(1);
    expect(screen.getByText(/Restart Cowork to finish installing the downloaded update \(UI → 2\.26\.7\.20\.1\)\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(onUpdateAction.mock.calls[0][0]).toBe('relaunch');
  });

  it('the manual installer notice suppresses the UI/server Restart (shell-first), as the sidebar does', () => {
    render(<SettingsView {...baseProps} updateState={stateFor({ ...uiReady, ...manualNotice() })} onUpdateAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Download installer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restart now/ })).toBeNull();
    expect(screen.queryByText(/Update ready/)).toBeNull();
  });

  it('an in-progress shell check does not hide a ready UI/server Restart card (checking is not pending)', () => {
    render(<SettingsView {...baseProps} updateState={stateFor({ ...uiReady, shell: shell('checking') })} onUpdateAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Restart now/ })).toBeInTheDocument();
    expect(screen.getByText(/Checking for an app update/)).toBeInTheDocument();
  });

  it('returns to a retryable state when the apply resolves false', async () => {
    const onUpdateAction = vi.fn(async () => false);
    render(<SettingsView {...baseProps} updateState={stateFor(uiReady)} onUpdateAction={onUpdateAction} />);
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeInTheDocument();
    expect(screen.getByText(/Couldn't apply the update/)).toBeInTheDocument();
  });

  it('"Check for updates" reports up to date only when the state agrees', async () => {
    render(<SettingsView {...baseProps} updateState={stateFor({})} onUpdateAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }));
    expect(await screen.findByText(/You're up to date/)).toBeInTheDocument();
    expect(host.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

// ENG-3291: a restart that stops the sidecar ends every running turn, so main
// may answer an apply request with `{ confirm, runningTasks }` instead of
// acting. The renderer guard (platform/restart-guard) asks through
// RestartConfirmHost and re-sends with `force` on a yes. These cases drive the
// real guard and dialog behind the one Settings button with a fake main.
import RestartConfirmHost from '../../../RestartConfirmHost';
import { guardRestart, resetRestartConfirmationForTests } from '../../../platform/restart-guard';

function fakeMain({ runningTasks }) {
  // Mirrors main: ask unless forced, then report the restart as done.
  return vi.fn(async (options = {}) => {
    if (!options.force && (runningTasks === null || runningTasks > 0)) return { confirm: true, runningTasks };
    return true;
  });
}

describe('SettingsView desktop — confirm before a restart ends running tasks (ENG-3291)', () => {
  afterEach(() => resetRestartConfirmationForTests());

  const readyShell = stateFor({ shell: shell('ready-to-install', { targetVersion: '2.260720.1' }) });
  const guarded = (main) => (action, hooks = {}) => guardRestart(main, hooks);

  it('asks before "Update ready" Restart now while tasks run, and Cancel keeps the update ready', async () => {
    const main = fakeMain({ runningTasks: 2 });
    render(
      <>
        <RestartConfirmHost />
        <SettingsView {...baseProps} updateState={readyShell} onUpdateAction={guarded(main)} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(await screen.findByText('Stop 2 running tasks and restart?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await screen.findByRole('button', { name: /Restart now/ });
    // One probe, no forced install: the tasks keep running and the card still offers Restart now.
    expect(main).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalledWith({ force: true });
    expect(screen.queryByText(/and restart\?/)).toBeNull();
  });

  it('restarts after Restart anyway', async () => {
    const main = fakeMain({ runningTasks: 1 });
    render(
      <>
        <RestartConfirmHost />
        <SettingsView {...baseProps} updateState={readyShell} onUpdateAction={guarded(main)} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(await screen.findByText('Stop 1 running task and restart?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restart anyway/ }));
    await waitFor(() => expect(main).toHaveBeenCalledWith({ force: true }));
  });

  it('restarts at once with no task running, with a single install call', async () => {
    const main = fakeMain({ runningTasks: 0 });
    render(
      <>
        <RestartConfirmHost />
        <SettingsView {...baseProps} updateState={readyShell} onUpdateAction={guarded(main)} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    await waitFor(() => expect(main).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/and restart\?/)).toBeNull();
  });

  it('still asks when the sidecar does not answer, and says it cannot tell', async () => {
    const main = fakeMain({ runningTasks: null });
    render(
      <>
        <RestartConfirmHost />
        <SettingsView {...baseProps} updateState={readyShell} onUpdateAction={guarded(main)} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(await screen.findByText(/cannot tell whether any tasks are running/)).toBeInTheDocument();
  });

  it('asks before an "Update ready" Restart now that includes a server update, and never reads "Restarting…" under the dialog', async () => {
    const main = fakeMain({ runningTasks: 3 });
    render(
      <>
        <RestartConfirmHost />
        <SettingsView
          {...baseProps}
          updateState={stateFor({ ota: { phase: 'available', version: '2.26.7.20.1', uiUpdate: true, serverUpdate: true, serverVersion: '0.26.7.20.1' } })}
          onUpdateAction={guarded(main)}
        />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(await screen.findByText('Stop 3 running tasks and restart?')).toBeInTheDocument();
    // The dialog is open and the card has not flipped to "Restarting…".
    expect(screen.queryByText(/Restarting…/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    // A cancelled apply is not a failure: the card returns to Restart now, not "Try again".
    expect(await screen.findByRole('button', { name: /Restart now/ })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't apply the update/)).toBeNull();
  });
});
