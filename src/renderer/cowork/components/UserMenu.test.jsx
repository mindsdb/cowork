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
const analyticsMock = vi.hoisted(() => ({
  resetDeviceIdentity: vi.fn(),
  trackBillingOpened: vi.fn(),
}));
vi.mock('../lib/analytics', () => analyticsMock);

import UserMenu from './UserMenu';
import { LOGOUT_CONFIRM_COPY } from '../hooks/useLogout';
import {
  MINDS_BILLING_URL,
  MINDS_MEMBERS_URL,
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
  analyticsMock.trackBillingOpened.mockClear();
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

describe('UserMenu — dropdown (ENG-1545 curated items)', () => {
  it('shows the org header (not the email) and the five curated destinations', () => {
    render(<UserMenu user={user} />);
    openMenu();
    // The org name heads the menu; the email is intentionally not shown here.
    expect(screen.getAllByText('MindsDB').length).toBeGreaterThan(0);
    expect(screen.queryByText('hazem@example.com')).toBeNull();
    for (const label of ['Settings', 'Billing & Usage', 'Members', 'Help & Feedback', 'Logout']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('drops the items curated away (Profile / General / Documentation / theme toggle)', () => {
    render(<UserMenu user={user} />);
    openMenu();
    for (const label of [/^Profile$/, /^General$/, /Documentation/, /Dark mode/, /Light mode/]) {
      expect(screen.queryByRole('menuitem', { name: label })).toBeNull();
    }
  });

  it('opens Settings in-app', () => {
    const onOpenSettings = vi.fn();
    render(<UserMenu user={user} onOpenSettings={onOpenSettings} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(hostMock.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    ['Billing & Usage', MINDS_BILLING_URL],
    ['Members', MINDS_MEMBERS_URL],
    ['Help & Feedback', MINDS_SUPPORT_URL],
  ])('opens %s in the OS browser', (label, url) => {
    render(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }));
    expect(hostMock.openExternal).toHaveBeenCalledWith(url);
  });

  // On web, host.logout() ends the Keycloak browser session, so Logout is a
  // real action and the item renders on both shells.
  it('shows Logout on the web shell and runs the logout flow', () => {
    hostMock.host.isElectron = false;
    hostMock.host.isWeb = true;
    render(<UserMenu user={user} />);
    openMenu();
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ }));
    expect(screen.getByText(LOGOUT_CONFIRM_COPY.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LOGOUT_CONFIRM_COPY.confirmLabel }));
    expect(hostMock.host.logout).toHaveBeenCalled();
  });

  it('asks for confirmation before logging out, then runs the logout flow', async () => {
    render(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ }));
    // Confirm modal — nothing signed out yet.
    expect(screen.getByText(LOGOUT_CONFIRM_COPY.title)).toBeInTheDocument();
    expect(hostMock.host.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: LOGOUT_CONFIRM_COPY.confirmLabel }));
    expect(hostMock.host.logout).toHaveBeenCalled();
  });
});

// ENG-1533: the menu is a real route to the billing page, so it emits
// billing_opened — but as `nav`, which is not upgrade intent. Keeping it
// separable is what stops a token_cap_hit -> billing_opened funnel counting
// people who were only checking their usage.
describe('UserMenu — billing route is measured as navigation (ENG-1533)', () => {
  it('records trigger=nav on Billing & Usage', () => {
    render(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Billing & Usage/ }));
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('nav');
    expect(hostMock.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it.each([['Members'], ['Help & Feedback'], ['Settings']])(
    'records nothing for %s — it is not a billing route',
    (label) => {
      render(<UserMenu user={user} onOpenSettings={vi.fn()} />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }));
      expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
    },
  );
});
