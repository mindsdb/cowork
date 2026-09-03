import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { computerRegistrationToken, copyText, controlPlane } = vi.hoisted(() => ({
  computerRegistrationToken: vi.fn(),
  copyText: vi.fn(async () => true),
  controlPlane: { origin: 'https://code.example.test' },
}));

vi.mock('../../../platform/host', () => ({
  getCodeControlPlaneOrigin: () => controlPlane.origin,
}));
vi.mock('../../code/api', () => ({ codingApi: { computerRegistrationToken } }));
vi.mock('../../lib/clipboard', () => ({ copyText }));

import { ConnectComputerModal, isLoopbackOrigin, shellSafeComputerName } from './ConnectComputerModal';

const pendingFor = (name: string, platform: 'darwin' | 'windows' | 'linux' = 'darwin') => ({
  id: 'pending-1', name, platform, created_at: '2026-09-03T10:00:00Z', expires_at: '2026-09-03T10:10:00Z', expired: false,
});

beforeEach(() => {
  controlPlane.origin = 'https://code.example.test';
  computerRegistrationToken.mockImplementation(async (body?: { name: string }) => ({
    registration_token: 'tok-123', expires_in_seconds: 600, pending: pendingFor(body?.name || 'My Mac'),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('shellSafeComputerName', () => {
  it('keeps everyday names intact', () => {
    expect(shellSafeComputerName("Ian's MacBook Pro")).toBe("Ian's MacBook Pro");
    expect(shellSafeComputerName('  build-box_02.local ')).toBe('build-box_02.local');
    expect(shellSafeComputerName('Zoë 電腦')).toBe('Zoë 電腦');
  });

  it('keeps combining marks and stays within the server\'s 120-character limit', () => {
    const decomposed = 'Zoë'.normalize('NFD');
    expect(shellSafeComputerName(decomposed)).toBe(decomposed);
    expect(shellSafeComputerName('x'.repeat(130))).toHaveLength(120);
    expect(shellSafeComputerName(`${'x'.repeat(119)} y`)).toBe('x'.repeat(119));
    expect(shellSafeComputerName('𠀀'.repeat(121))).toBe('𠀀'.repeat(120));
    expect(shellSafeComputerName(`${'x'.repeat(119)}e\u0308y`)).toBe('x'.repeat(119));
  });

  it('drops every character a shell could interpret', () => {
    expect(shellSafeComputerName('Mac "$(rm -rf ~)"')).toBe('Mac rm -rf');
    expect(shellSafeComputerName('pc`whoami`;echo %PATH%|cat')).toBe('pcwhoamiecho PATHcat');
    expect(shellSafeComputerName('--help')).toBe('help');
  });
});

describe('isLoopbackOrigin', () => {
  it.each(['http://127.0.0.1:26866', 'http://localhost:26866', 'http://[::1]:8000'])('recognises %s', (origin) => {
    expect(isLoopbackOrigin(origin)).toBe(true);
  });

  it.each(['https://code.example.test', 'http://10.0.0.5:8000', 'not a url'])('rejects %s', (origin) => {
    expect(isLoopbackOrigin(origin)).toBe(false);
  });
});

describe('ConnectComputerModal', () => {
  it('saves the named computer as pending, then shows the command for it', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<ConnectComputerModal open onClose={vi.fn()} onChanged={onChanged} />);
    expect(computerRegistrationToken).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('My Mac'), 'Build box');
    await user.click(screen.getByRole('button', { name: 'Add computer' }));

    expect(computerRegistrationToken).toHaveBeenCalledWith({ name: 'Build box', platform: 'darwin', replaces: undefined });
    expect(await screen.findByText(/--code "tok-123"/)).toHaveTextContent('--name "Build box"');
    expect(screen.getByText('Waiting to connect')).toBeInTheDocument();
    expect(screen.getByText('Connect Build box')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('keeps showing the command when the parent re-renders with a new onChanged callback', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ConnectComputerModal open onClose={vi.fn()} onChanged={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Add computer' }));
    await screen.findByText(/--code "tok-123"/);

    rerender(<ConnectComputerModal open onClose={vi.fn()} onChanged={() => {}} />);

    expect(screen.getByText(/--code "tok-123"/)).toBeInTheDocument();
    expect(computerRegistrationToken).toHaveBeenCalledTimes(1);
  });

  it('still shows the command when an older server answers without a pending entry', async () => {
    computerRegistrationToken.mockResolvedValue({ registration_token: 'tok-old', expires_in_seconds: 600 });
    const user = userEvent.setup();
    render(<ConnectComputerModal open onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('My Mac'), 'Legacy box');
    await user.click(screen.getByRole('button', { name: 'Add computer' }));

    expect(await screen.findByText(/--code "tok-old"/)).toHaveTextContent('--name "Legacy box"');
  });

  it('never lets typed shell syntax into the pasted command', async () => {
    const user = userEvent.setup();
    render(<ConnectComputerModal open onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('My Mac'), 'Mac "$(rm -rf ~)"');
    await user.click(screen.getByRole('button', { name: 'Add computer' }));

    const command = (await screen.findByText(/cowork-code-runtime/)).textContent;
    expect(command).toContain('--name "Mac rm -rf"');
    expect(command).not.toMatch(/[$()~`]/);
    expect(command?.match(/"/g)).toHaveLength(6);
  });

  it('issues a fresh code for an existing pending computer without asking for its name again', async () => {
    render(<ConnectComputerModal open onClose={vi.fn()} pending={pendingFor('Old laptop', 'linux')} />);

    expect(await screen.findByText(/--code "tok-123"/)).toHaveTextContent('--name "Old laptop"');
    expect(computerRegistrationToken).toHaveBeenCalledWith({ name: 'Old laptop', platform: 'linux', replaces: 'pending-1' });
    expect(screen.queryByPlaceholderText('My Linux computer')).toBeNull();
  });

  it('still saves the computer behind a private local control plane and explains what is missing', async () => {
    controlPlane.origin = 'http://[::1]:8000';
    const user = userEvent.setup();
    render(<ConnectComputerModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add computer' }));

    expect(await screen.findByRole('status')).toHaveTextContent('private local Code service');
    expect(computerRegistrationToken).toHaveBeenCalledWith({ name: 'My Mac', platform: 'darwin', replaces: undefined });
    expect(screen.queryByText(/cowork-code-runtime/)).toBeNull();
  });

  it('withdraws the command once the code expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    computerRegistrationToken.mockResolvedValue({ registration_token: 'tok-123', expires_in_seconds: 1, pending: pendingFor('My Mac') });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConnectComputerModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add computer' }));
    await screen.findByText(/--code "tok-123"/);
    expect(screen.getByText('Code expires in 0:01')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });

    expect(screen.queryByText(/tok-123/)).not.toBeInTheDocument();
    expect(screen.getByText('This connection code has expired.')).toBeInTheDocument();
    expect(screen.queryByText(/Code expires in/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy connection command' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /New code/ })).toBeInTheDocument();
  });
});
