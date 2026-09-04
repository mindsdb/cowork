import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => {
  const listeners: Record<string, ((payload?: unknown) => void)[]> = {};
  const on = (name: string) => (cb: (payload?: unknown) => void) => {
    (listeners[name] ||= []).push(cb);
    return () => { listeners[name] = (listeners[name] || []).filter((item) => item !== cb); };
  };
  return {
    listeners,
    emit: (name: string, payload?: unknown) => { for (const cb of listeners[name] || []) cb(payload); },
    startCodeSetup: vi.fn(async () => true),
    cancelCodeSetup: vi.fn(async () => undefined),
    on,
  };
});

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    startCodeSetup: hostMock.startCodeSetup,
    cancelCodeSetup: hostMock.cancelCodeSetup,
    onCodeSetupProgress: hostMock.on('progress'),
    onCodeSetupLog: hostMock.on('log'),
    onCodeSetupDone: hostMock.on('done'),
    onCodeSetupError: hostMock.on('error'),
    onCodeSetupCancelled: hostMock.on('cancelled'),
  },
}));

import { CodeSetupModal } from './CodeSetupModal';

const steps = (status: string) => [
  { id: 'components', label: 'Download Code Mode components', status },
  { id: 'restart', label: 'Restart the Code service', status: 'pending' },
  { id: 'verify', label: 'Check the coding agent', status: 'pending' },
];

describe('CodeSetupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(hostMock.listeners)) delete hostMock.listeners[key];
  });

  it('starts the setup when opened, shows the steps and output, and hands over on completion', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<CodeSetupModal open onClose={vi.fn()} onComplete={onComplete} />);

    expect(hostMock.startCodeSetup).toHaveBeenCalledOnce();
    act(() => hostMock.emit('progress', [{ id: 'git', label: 'Install Git', status: 'running', hint: 'Windows will ask to allow Git for Windows to make changes. Choose Yes.' }, ...steps('pending')]));
    expect(screen.getByRole('list', { name: 'Setup steps' })).toHaveTextContent('Windows will ask to allow Git for Windows to make changes. Choose Yes.');
    act(() => hostMock.emit('progress', steps('running')));
    expect(screen.getByRole('list', { name: 'Setup steps' })).toHaveTextContent('Download Code Mode components');
    expect(screen.getByText('In progress')).toBeInTheDocument();
    act(() => hostMock.emit('log', 'Installing cowork-server[code]==1.0\n'));
    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByLabelText('Setup output')).toHaveTextContent('Installing cowork-server[code]==1.0');

    act(() => { hostMock.emit('progress', steps('done').map((s) => ({ ...s, status: 'done' }))); hostMock.emit('done'); });
    expect(screen.getByText('Code Mode is ready on this computer.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Code Mode' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('cannot be dismissed while running, and Cancel asks main to stop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CodeSetupModal open onClose={onClose} onComplete={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(hostMock.cancelCodeSetup).toHaveBeenCalledOnce();
    act(() => hostMock.emit('cancelled'));
    expect(screen.getByText(/Setup was cancelled/)).toBeInTheDocument();
    // Header X and footer button both read Close once the run has ended.
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows what failed and starts again on Try again', async () => {
    const user = userEvent.setup();
    render(<CodeSetupModal open onClose={vi.fn()} onComplete={vi.fn()} />);

    act(() => { hostMock.emit('progress', steps('error')); hostMock.emit('error', 'The components did not install. Check your connection and disk space, then try again.'); });
    expect(screen.getByText(/did not install/)).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(hostMock.startCodeSetup).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/did not install/)).toBeNull();
  });
});
