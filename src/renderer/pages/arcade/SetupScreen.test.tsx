import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({
  startInstall: vi.fn(async () => {}),
  cancelInstall: vi.fn(async () => {}),
  onInstallProgress: vi.fn(() => () => {}),
  onInstallLog: vi.fn(() => () => {}),
  onInstallDone: vi.fn(() => () => {}),
  onInstallError: vi.fn(() => () => {}),
  onInstallCancelled: vi.fn(() => () => {}),
}));
vi.mock('../../platform/host', () => ({ host: hostMock }));

import SetupScreen from './SetupScreen';

describe('SetupScreen — "Install backend server" checkbox', () => {
  beforeEach(() => {
    hostMock.startInstall.mockClear();
  });

  it('defaults to checked and does not start installing until Continue is clicked', () => {
    render(<SetupScreen onComplete={() => {}} />);

    expect(screen.getByRole('checkbox', { name: 'Install backend server' })).toBeChecked();
    expect(hostMock.startInstall).not.toHaveBeenCalled();
  });

  it('starts the install with installBackend=true by default on Continue', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onComplete={() => {}} />);

    await user.click(screen.getByRole('button', { name: /INSTALL & CONTINUE/ }));

    expect(hostMock.startInstall).toHaveBeenCalledWith(true);
  });

  it('unchecking and continuing starts the install with installBackend=false', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onComplete={() => {}} />);

    await user.click(screen.getByRole('checkbox', { name: 'Install backend server' }));
    expect(screen.getByRole('checkbox', { name: 'Install backend server' })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /CONTINUE WITHOUT A BACKEND/ }));

    expect(hostMock.startInstall).toHaveBeenCalledWith(false);
  });
});
