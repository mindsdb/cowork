import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// A phone's browser renders MobileShell instead of the sidebar, so Code mode
// needs its own row in the drawer. The native mobile app and a self-hosted
// build show none.
const state = vi.hoisted(() => ({ isMobileShell: false, platformUi: true }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isWeb: true,
      openExternal: vi.fn(),
      get isMobileShell() { return state.isMobileShell; },
    },
  };
});
vi.mock('../../lib/deployment', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, get PLATFORM_UI() { return state.platformUi; } };
});
const analytics = vi.hoisted(() => ({
  trackDesktopOfferShown: vi.fn(),
  trackDesktopOfferDownloadClicked: vi.fn(),
}));
vi.mock('../lib/analytics', () => analytics);

import MobileShell from './MobileShell';

const baseProps = { route: 'home', tasks: [], projects: [], scheduled: [], artifacts: [] };

function codeRow() {
  return screen.queryByRole('button', { name: /^Code\s*Desktop$/ });
}

beforeEach(() => {
  state.isMobileShell = false;
  state.platformUi = true;
  vi.clearAllMocks();
});

describe('MobileShell — Code mode in a phone browser', () => {
  it('lists Code in the drawer, and choosing it opens the offer over the open drawer', () => {
    render(<MobileShell {...baseProps}>content</MobileShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    fireEvent.click(codeRow());

    const dialog = screen.getByRole('dialog', { name: 'Code mode runs in the Desktop app' });
    expect(within(dialog).getByRole('button', { name: 'Download the Desktop app' })).toBeInTheDocument();
    expect(analytics.trackDesktopOfferShown).toHaveBeenCalledWith({ feature: 'code_mode', entry: 'mobile_drawer' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Closing the offer leaves the person in the drawer they opened it from.
    expect(document.querySelector('.mshell__drawer')).toHaveClass('is-open');
  });

  it('closes the drawer on Escape when no offer is open', () => {
    render(<MobileShell {...baseProps}>content</MobileShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.querySelector('.mshell__drawer')).not.toHaveClass('is-open');
  });

  it('closes only the offer on Escape, and keeps the drawer open', () => {
    render(<MobileShell {...baseProps}>content</MobileShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    fireEvent.click(codeRow());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.mshell__drawer')).toHaveClass('is-open');
  });

  it('shows no Code row inside the mobile app', () => {
    state.isMobileShell = true;
    render(<MobileShell {...baseProps}>content</MobileShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(codeRow()).toBeNull();
  });

  it('shows no Code row in a self-hosted build', () => {
    state.platformUi = false;
    render(<MobileShell {...baseProps}>content</MobileShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(codeRow()).toBeNull();
  });
});
