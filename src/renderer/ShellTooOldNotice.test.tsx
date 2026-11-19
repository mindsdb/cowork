import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The launch notice for a shell below the supported window (ENG-1047): one
// action routed by the auto-updater's phase, dismiss for this launch only.
const hostMock = vi.hoisted(() => ({
  installShellAutoUpdate: vi.fn(async () => true),
  downloadShellAutoUpdate: vi.fn(async () => ({ phase: 'downloading' })),
  checkShellAutoUpdate: vi.fn(async () => ({ phase: 'checking' })),
  getShellUpdate: vi.fn(async () => null as null | { downloadUrl?: string }),
  openExternal: vi.fn(async () => {}),
}));
vi.mock('./platform/host', () => ({ host: hostMock }));

import { ShellTooOldNotice } from './ShellTooOldNotice';
import type { ShellSupportVerdict } from '../shared/shell-support';

const tooOld: ShellSupportVerdict = {
  status: 'too-old',
  reason: 'below-floor',
  shellVersion: '2.26.9.1.3',
  latestShellVersion: '2.26.10.4.1',
  daysBehind: 33,
};

const snapshot = (phase: string, extra: Record<string, unknown> = {}) => ({
  phase,
  mode: 'auto',
  channel: 'prod',
  currentVersion: '2.26.9.1.3',
  ...extra,
}) as never;

beforeEach(() => {
  hostMock.installShellAutoUpdate.mockClear();
  hostMock.downloadShellAutoUpdate.mockClear();
  hostMock.checkShellAutoUpdate.mockClear();
  hostMock.getShellUpdate.mockReset().mockResolvedValue(null);
  hostMock.openExternal.mockClear();
});

describe('ShellTooOldNotice', () => {
  it('names the installed shell and announces itself', () => {
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={null} onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('too old for this version of Cowork');
    expect(screen.getByRole('alert')).toHaveTextContent('2.26.9.1.3');
    expect(screen.getByRole('alert')).toHaveTextContent('2.26.10.4.1');
  });

  it('renders nothing for a supported shell', () => {
    const supported: ShellSupportVerdict = {
      status: 'supported', shellVersion: '2.26.10.4.1', latestShellVersion: '2.26.10.4.1', daysBehind: 0,
    };
    const { container } = render(<ShellTooOldNotice verdict={supported} shellAuto={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dismisses through the caller, which owns the per-launch state', () => {
    const onDismiss = vi.fn();
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={null} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss until the next launch/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('restarts into a downloaded shell update', async () => {
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={snapshot('ready-to-install')} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(hostMock.installShellAutoUpdate).toHaveBeenCalledTimes(1));
    expect(hostMock.openExternal).not.toHaveBeenCalled();
  });

  it('starts the download when the auto-updater has found an update', async () => {
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={snapshot('available')} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    await waitFor(() => expect(hostMock.downloadShellAutoUpdate).toHaveBeenCalledTimes(1));
  });

  it('is display-only while the updater is downloading', () => {
    render(
      <ShellTooOldNotice
        verdict={tooOld}
        shellAuto={snapshot('downloading', { progress: { percent: 42 } })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Downloading (42%)' })).toBeDisabled();
  });

  it('opens the download page on a shell that cannot update itself', async () => {
    // No snapshot at all: a shell older than the auto-updater (before 2.26.8.24.1).
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={null} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download the latest app' }));
    await waitFor(() => expect(hostMock.openExternal).toHaveBeenCalledWith('https://mindshub.ai/download'));
    expect(hostMock.installShellAutoUpdate).not.toHaveBeenCalled();
  });

  it('prefers the per-platform installer URL when a newer shell supplied one', async () => {
    hostMock.getShellUpdate.mockResolvedValue({ downloadUrl: 'https://d/linux-amd64/mindshub-cowork-latest.deb' });
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={snapshot('disabled')} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download the latest app' }));
    await waitFor(() => expect(hostMock.openExternal).toHaveBeenCalledWith('https://d/linux-amd64/mindshub-cowork-latest.deb'));
  });

  it('retries a recoverable updater failure instead of leaving the app', async () => {
    render(<ShellTooOldNotice verdict={tooOld} shellAuto={snapshot('failed', { recoverable: true })} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    await waitFor(() => expect(hostMock.checkShellAutoUpdate).toHaveBeenCalledTimes(1));
  });
});
