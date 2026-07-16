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

describe('Sidebar — footer theme toggle (design polish PR 3: chrome)', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('renders the theme toggle in the footer and calls onToggleTheme when clicked', () => {
    hostMock.isWeb = false;
    const onToggleTheme = vi.fn();
    render(
      <Sidebar {...baseProps} serverOnline theme="dark" onToggleTheme={onToggleTheme} />
    );
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    toggle.click();
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('still shows the theme toggle on the web build, which hides Settings', () => {
    hostMock.isWeb = true;
    const onToggleTheme = vi.fn();
    render(
      <Sidebar {...baseProps} theme="light" onToggleTheme={onToggleTheme} />
    );
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('renders the 8-bit skin toggle next to the theme toggle and calls onToggleSkin', () => {
    hostMock.isWeb = false;
    const onToggleSkin = vi.fn();
    render(
      <Sidebar {...baseProps} serverOnline skin="normal" onToggleSkin={onToggleSkin} />
    );
    const toggle = screen.getByRole('button', { name: 'Toggle 8-bit style' });
    expect(toggle.className).not.toContain('is-on');
    toggle.click();
    expect(onToggleSkin).toHaveBeenCalledTimes(1);
  });

  it('lights the skin toggle when a non-default skin is active', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline skin="8bit" />);
    expect(
      screen.getByRole('button', { name: 'Toggle 8-bit style' }).className
    ).toContain('is-on');
  });
});
