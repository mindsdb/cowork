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

import { isLoopbackOrigin } from '../../code/controlPlane';
import { ConnectComputerModal, shellSafeComputerName } from './ConnectComputerModal';

beforeEach(() => {
  controlPlane.origin = 'https://code.example.test';
  computerRegistrationToken.mockResolvedValue({ registration_token: 'tok-123', expires_in_seconds: 600 });
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
  it('never lets typed shell syntax into the pasted command', async () => {
    const user = userEvent.setup();
    render(<ConnectComputerModal open onClose={vi.fn()} />);
    await screen.findByText(/--code "tok-123"/);

    await user.type(screen.getByPlaceholderText('My Mac'), 'Mac "$(rm -rf ~)"');

    const command = screen.getByText(/cowork-code-runtime/).textContent;
    expect(command).toContain('--name "Mac rm -rf"');
    expect(command).not.toMatch(/[$()~`]/);
    expect(command?.match(/"/g)).toHaveLength(6);
  });

  it('treats an IPv6 loopback control plane as private, like 127.0.0.1', () => {
    controlPlane.origin = 'http://[::1]:8000';
    render(<ConnectComputerModal open onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('private local Code service');
    expect(computerRegistrationToken).not.toHaveBeenCalled();
  });

  it('withdraws the command once the code expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    computerRegistrationToken.mockResolvedValue({ registration_token: 'tok-123', expires_in_seconds: 1 });
    render(<ConnectComputerModal open onClose={vi.fn()} />);
    await screen.findByText(/--code "tok-123"/);
    expect(screen.getByText('Expires in 0:01')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });

    expect(screen.queryByText(/tok-123/)).not.toBeInTheDocument();
    expect(screen.getByText('This connection code has expired.')).toBeInTheDocument();
    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy connection command' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /New code/ })).toBeInTheDocument();
  });
});
