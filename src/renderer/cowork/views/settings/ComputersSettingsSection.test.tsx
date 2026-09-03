import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodeComputer } from '../../code/api';
import { resetDocumentVisibility, setDocumentVisibility } from '../../../../../tests/helpers/visibility';

const computers = vi.hoisted(() => vi.fn());

vi.mock('../../code/api', () => ({ codingApi: { computers } }));
vi.mock('./ConnectComputerModal', () => ({ ConnectComputerModal: () => null }));

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
});
