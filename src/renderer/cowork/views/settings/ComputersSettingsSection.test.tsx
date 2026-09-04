import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodeComputer } from '../../code/api';
import { resetDocumentVisibility, setDocumentVisibility } from '../../../../../tests/helpers/visibility';

const { computers, controlPlane } = vi.hoisted(() => ({ computers: vi.fn(), controlPlane: { reachable: true } }));

vi.mock('../../code/api', () => ({ codingApi: { computers } }));
vi.mock('../../code/controlPlane', () => ({ codeControlPlaneReachable: () => controlPlane.reachable }));
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
    controlPlane.reachable = true;
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

  it('offers Connect computer only where another computer could reach this Code service', async () => {
    computers.mockResolvedValue({ items: [local] });
    render(<ComputersSettingsSection />);
    await advance(0);

    expect(screen.getByRole('heading', { name: 'Run Code beyond this computer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect computer/ })).toBeInTheDocument();
  });

  it('hides the connect flow on a desktop whose Code service is private to this machine', async () => {
    controlPlane.reachable = false;
    computers.mockResolvedValue({ items: [local] });
    render(<ComputersSettingsSection />);
    await advance(0);

    expect(screen.getAllByText('This computer').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Run Code beyond this computer' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Connect computer/ })).toBeNull();
    // The hosted-compute card still shows where this is heading.
    expect(screen.getByText('Managed compute')).toBeInTheDocument();
  });

});
