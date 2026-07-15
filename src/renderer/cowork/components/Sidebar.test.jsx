import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mutable host mock so each test can flip isWeb. Sidebar reads host.isWeb at
// render time to decide whether to show the web-only Channels entry (ENG-720:
// Channels lives under Settings, which the web shell hides, so the hosted
// build needs a standalone left-nav entry; the desktop app reaches it via
// Settings and must NOT get a duplicate).
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false }));
vi.mock('../../platform/host', () => ({ host: hostMock }));

import Sidebar from './Sidebar';

const baseProps = { tasks: [], onNavigate: () => {} };

describe('Sidebar — Channels entry (ENG-720)', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('shows a Channels nav item in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Channels' })).toBeInTheDocument();
  });

  it('hides the Channels nav item in the Electron build (reachable via Settings there)', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Channels' })).toBeNull();
  });

  it('navigates to the channels route when the web nav item is clicked', () => {
    const onNavigate = vi.fn();
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Channels' }).click();
    expect(onNavigate).toHaveBeenCalledWith('channels');
  });
});
