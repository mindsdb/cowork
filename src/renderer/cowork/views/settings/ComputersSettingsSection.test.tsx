import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodeComputer } from '../../code/api';
import { resetDocumentVisibility, setDocumentVisibility } from '../../../../../tests/helpers/visibility';

const { computers, revokeComputer, modalProps } = vi.hoisted(() => ({
  computers: vi.fn(),
  revokeComputer: vi.fn(async () => undefined),
  modalProps: { current: null as null | { open: boolean; pending?: { id: string; name: string } | null } },
}));

vi.mock('../../code/api', () => ({ codingApi: { computers, revokeComputer } }));
vi.mock('./ConnectComputerModal', () => ({
  ConnectComputerModal: (props: { open: boolean; pending?: { id: string; name: string } | null }) => {
    modalProps.current = props;
    return props.open ? <div>Connect computer modal for {props.pending?.name || 'a new computer'}</div> : null;
  },
}));

import ComputersSettingsSection from './ComputersSettingsSection';

const local = {
  id: 'local',
  name: 'This computer',
  is_local: true,
  status: 'online',
  active_run_count: 0,
  last_seen_at: '2026-09-01T09:00:00Z',
  capabilities: { platform: 'darwin', architecture: 'arm64', runtime_version: 'cowork-desktop-1' },
} as unknown as CodeComputer;

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('ComputersSettingsSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    computers.mockResolvedValue({ items: [local] });
  });

  afterEach(() => {
    resetDocumentVisibility();
    vi.useRealTimers();
  });

  it('backs off while the computer list cannot be loaded and recovers at the normal rate', async () => {
    computers.mockRejectedValue(new Error('Control plane unreachable'));
    render(<ComputersSettingsSection />);
    await advance(0);
    expect(computers).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Control plane unreachable');

    await advance(5_000);
    expect(computers).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(computers).toHaveBeenCalledTimes(2);
    await advance(15_000);
    expect(computers).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(computers).toHaveBeenCalledTimes(3);

    computers.mockResolvedValue({ items: [local] });
    await advance(40_000);
    expect(computers).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await advance(5_000);
    expect(computers).toHaveBeenCalledTimes(5);
  });

  it('pauses polling while the document is hidden and refreshes once it is visible', async () => {
    render(<ComputersSettingsSection />);
    await advance(0);
    expect(computers).toHaveBeenCalledTimes(1);

    act(() => setDocumentVisibility('hidden'));
    await advance(30_000);
    expect(computers).toHaveBeenCalledTimes(1);

    act(() => setDocumentVisibility('visible'));
    await advance(0);
    expect(computers).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(computers).toHaveBeenCalledTimes(3);
  });

  it('lists a computer that was named but has not connected yet, with New code and Remove', async () => {
    computers.mockResolvedValue({
      items: [local],
      pending: [{ id: 'pending-1', name: 'Build box', platform: 'linux', created_at: '2026-09-03T10:00:00Z', expires_at: new Date(Date.now() + 9 * 60_000).toISOString(), expired: false }],
    });
    render(<ComputersSettingsSection />);
    await advance(0);

    const row = screen.getByLabelText('Build box, waiting to connect');
    expect(row).toHaveTextContent('Waiting to connect');
    expect(row).toHaveTextContent('Linux · Connection code expires in 9 min');

    // New code reopens the dialog for that computer instead of asking for a name again.
    await act(async () => { screen.getByRole('button', { name: /New code/ }).click(); });
    expect(screen.getByText('Connect computer modal for Build box')).toBeInTheDocument();
    expect(modalProps.current?.pending?.id).toBe('pending-1');

    await act(async () => { screen.getByRole('button', { name: 'Remove' }).click(); });
    expect(revokeComputer).toHaveBeenCalledWith('pending-1');
    expect(screen.queryByLabelText('Build box, waiting to connect')).toBeNull();
  });

  it('marks an expired connection code without hiding the computer', async () => {
    computers.mockResolvedValue({
      items: [local],
      pending: [{ id: 'pending-2', name: 'Old laptop', platform: 'darwin', created_at: '2026-09-03T09:00:00Z', expires_at: '2026-09-03T09:10:00Z', expired: true }],
    });
    render(<ComputersSettingsSection />);
    await advance(0);

    expect(screen.getByLabelText('Old laptop, waiting to connect')).toHaveTextContent('macOS · Connection code expired');
  });
});
