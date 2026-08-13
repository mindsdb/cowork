import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  host: {
    isWeb: false,
    isElectron: true,
    isMac: () => false,
    logout: vi.fn(async () => { }),
  },
  openExternal: vi.fn(async () => { }),
}));
vi.mock('../../platform/host', () => hostMock);
vi.mock('../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));

import UserMenu from './UserMenu';
import { LOGOUT_CONFIRM_COPY } from '../hooks/useLogout';
import {
  MINDS_BILLING_URL,
  MINDS_DOCS_URL,
  MINDS_MEMBERS_URL,
  MINDS_PROFILE_URL,
  MINDS_SUPPORT_URL,
} from '../../lib/mindsUrls';

const user = {
  name: 'Hazem Ahmed',
  email: 'hazem@example.com',
  username: 'hazem',
  org: 'MindsDB',
  picture: null,
  sub: 'user-1',
};

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /Hazem Ahmed/ }));
};

beforeEach(() => {
  hostMock.openExternal.mockClear();
  hostMock.host.logout.mockClear();
  hostMock.host.isElectron = true;
  hostMock.host.isWeb = false;
});

describe('UserMenu — footer row (ENG-1408)', () => {
  it('renders name · org with an initials placeholder when there is no picture', () => {
    render(<UserMenu user={user} theme="light" />);
    const row = screen.getByRole('button', { name: /Hazem Ahmed/ });
    expect(row.textContent).toContain('Hazem Ahmed');
    expect(row.textContent).toContain('·');
    expect(row.textContent).toContain('MindsDB');
    expect(row.textContent).toContain('HA'); // initials placeholder
  });

  it('keeps just the name when the account has no organization', () => {
    render(<UserMenu user={{ ...user, org: null }} theme="light" />);
    const row = screen.getByRole('button', { name: /Hazem Ahmed/ });
    expect(row.textContent).not.toContain('·');
    expect(row.textContent).not.toContain('MindsDB');
  });

  it('renders the picture as the avatar when the account carries one', () => {
    const { container } = render(
      <UserMenu user={{ ...user, picture: 'https://cdn.example.com/a.png' }} theme="light" />
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/a.png');
  });
});

describe('UserMenu — dropdown', () => {
  it('shows the email header, org, and every destination', () => {
    render(<UserMenu user={user} theme="light" />);
    openMenu();
    expect(screen.getByText('hazem@example.com')).toBeInTheDocument();
    for (const label of ['Settings', 'Profile', 'Billing & Usage', 'Members', 'Documentation', 'Help & feedback', 'Dark mode', 'Sign out']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('opens Settings in-app', () => {
    const onOpenSettings = vi.fn();
    render(<UserMenu user={user} theme="light" onOpenSettings={onOpenSettings} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(hostMock.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    ['Profile', MINDS_PROFILE_URL],
    ['Billing & Usage', MINDS_BILLING_URL],
    ['Members', MINDS_MEMBERS_URL],
    ['Documentation', MINDS_DOCS_URL],
    ['Help & feedback', MINDS_SUPPORT_URL],
  ])('opens %s in the OS browser', (label, url) => {
    render(<UserMenu user={user} theme="light" />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }));
    expect(hostMock.openExternal).toHaveBeenCalledWith(url);
  });

  it('flips the theme label and calls onToggleTheme', () => {
    const onToggleTheme = vi.fn();
    render(<UserMenu user={user} theme="dark" onToggleTheme={onToggleTheme} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Light mode/ }));
    expect(onToggleTheme).toHaveBeenCalled();
  });

  // The web shell's session is owned by Keycloak in the browser and
  // host.logout() is a no-op there — a Sign out item would silently do
  // nothing, so it's Electron-only (matching the Settings account section).
  it('hides Sign out on the web shell', () => {
    hostMock.host.isElectron = false;
    hostMock.host.isWeb = true;
    render(<UserMenu user={user} theme="light" />);
    openMenu();
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Sign out/ })).toBeNull();
  });

  it('asks for confirmation before signing out, then runs the logout flow', async () => {
    render(<UserMenu user={user} theme="light" />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
    // Confirm modal — nothing signed out yet.
    expect(screen.getByText(LOGOUT_CONFIRM_COPY.title)).toBeInTheDocument();
    expect(hostMock.host.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: LOGOUT_CONFIRM_COPY.confirmLabel }));
    expect(hostMock.host.logout).toHaveBeenCalled();
  });
});
