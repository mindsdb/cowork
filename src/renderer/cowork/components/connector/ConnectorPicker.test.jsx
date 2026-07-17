import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api registry fetch — the picker loads connectors on open.
const apiMock = vi.hoisted(() => ({
  fetchConnectors: vi.fn(async () => ([
    { id: 'gmail', label: 'Gmail', category: 'communication', description: 'Read, search, and send messages.' },
  ])),
}));
vi.mock('../../api', () => apiMock);

// Host facade — mutable isElectron so tests can flip between the desktop
// and web builds (the Browser Control tile is Electron-only).
const mockHost = vi.hoisted(() => ({ isElectron: true, isWeb: false }));
vi.mock('../../../platform/host', () => ({ host: mockHost, default: mockHost }));

import ConnectorPicker from './ConnectorPicker';

beforeEach(() => {
  vi.clearAllMocks();
  mockHost.isElectron = true;
});

describe('ConnectorPicker — pinned Browser Control tile (Task A1)', () => {
  it('renders the pinned tile under a Desktop heading on Electron', async () => {
    render(<ConnectorPicker open onPick={vi.fn()} onPickBrowserControl={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('browser-control-tile')).toBeInTheDocument());
    expect(screen.getByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('Browser Control')).toBeInTheDocument();
    // "Read-only" mini-chip per the a1-connector-tile mockups.
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    // Expectation-setting copy: the tile explains the dedicated Chrome
    // window so users know their regular tabs are untouched.
    expect(screen.getByText(/dedicated Chrome window/)).toBeInTheDocument();
    // Registry connectors are unaffected by the pinned section.
    expect(await screen.findByText('Gmail')).toBeInTheDocument();
  });

  it('does NOT render the tile when not running in Electron (web build)', async () => {
    mockHost.isElectron = false;
    render(<ConnectorPicker open onPick={vi.fn()} onPickBrowserControl={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Gmail')).toBeInTheDocument());
    expect(screen.queryByTestId('browser-control-tile')).not.toBeInTheDocument();
    expect(screen.queryByText('Browser Control')).not.toBeInTheDocument();
  });

  it('clicking the tile calls onPickBrowserControl (not onPick)', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onPickBrowserControl = vi.fn();
    render(<ConnectorPicker open onPick={onPick} onPickBrowserControl={onPickBrowserControl} onClose={vi.fn()} />);
    await user.click(await screen.findByTestId('browser-control-tile'));
    expect(onPickBrowserControl).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('search matches the tile — "browser control" no longer yields "No connectors match"', async () => {
    const user = userEvent.setup();
    render(<ConnectorPicker open onPick={vi.fn()} onPickBrowserControl={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Gmail');
    await user.type(screen.getByLabelText('Search connectors'), 'browser control');
    expect(screen.getByTestId('browser-control-tile')).toBeInTheDocument();
    expect(screen.queryByText(/No connectors match/)).not.toBeInTheDocument();
    // Registry connectors that don't match are filtered out.
    expect(screen.queryByText('Gmail')).not.toBeInTheDocument();
  });

  it('search also matches the tile via keywords (chrome, tab)', async () => {
    const user = userEvent.setup();
    render(<ConnectorPicker open onPick={vi.fn()} onPickBrowserControl={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Gmail');
    await user.type(screen.getByLabelText('Search connectors'), 'chrome');
    expect(screen.getByTestId('browser-control-tile')).toBeInTheDocument();
  });

  it('a non-matching search hides the tile and shows the empty state', async () => {
    const user = userEvent.setup();
    render(<ConnectorPicker open onPick={vi.fn()} onPickBrowserControl={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Gmail');
    await user.type(screen.getByLabelText('Search connectors'), 'zzz-no-such-thing');
    expect(screen.queryByTestId('browser-control-tile')).not.toBeInTheDocument();
    expect(screen.getByText(/No connectors match/)).toBeInTheDocument();
  });
});
