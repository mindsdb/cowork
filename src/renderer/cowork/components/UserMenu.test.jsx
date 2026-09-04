import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

/**
 * The menu reads a platform-neutral organization hook. Stubbing the hook keeps
 * every test below about the menu; Electron and web routing have their own
 * focused coverage.
 */
const orgsMock = vi.hoisted(() => ({
  state: { orgs: [], activeOrg: null, activeOrgId: null, switching: false },
  switchOrg: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../hooks/useMindsOrgs', () => ({
  useMindsOrgs: () => ({ ...orgsMock.state, switchOrg: orgsMock.switchOrg, refresh: vi.fn() }),
}));

import UserMenu from './UserMenu';
import { PERSONAL_ORG_LABEL as PERSONAL_LABEL } from '../../../shared/minds-orgs';
import ToastProvider from './ui/Toast';
import { LOGOUT_CONFIRM_COPY } from '../hooks/useLogout';
import {
  MINDS_BILLING_URL,
  MINDS_GENERAL_URL,
  MINDS_MEMBERS_URL,
  MINDS_SUPPORT_URL,
} from '../../lib/mindsUrls';

// `useToastManager` throws outside a provider, and the real tree always has
// one (App wraps AppCore, and the sidebar is inside it). Wrapping here is the
// honest fix; making the component tolerate a missing provider would not be.
const renderMenu = (element) => render(<ToastProvider>{element}</ToastProvider>);

const ACME = { id: 'org-acme', name: 'acme.example', displayName: 'acme.example', isPersonal: false };
const PERSONAL = {
  id: 'org-personal',
  name: 'personal_user-1',
  displayName: "hazem@example.com's organization",
  isPersonal: true,
};

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
  orgsMock.state = { orgs: [], activeOrg: null, activeOrgId: null, switching: false };
  orgsMock.switchOrg.mockClear();
  orgsMock.switchOrg.mockResolvedValue({ ok: true });
});

describe('UserMenu — footer row (ENG-1408)', () => {
  it('renders name · org with an initials placeholder when there is no picture', () => {
    renderMenu(<UserMenu user={user} theme="light" />);
    const row = screen.getByRole('button', { name: /Hazem Ahmed/ });
    expect(row.textContent).toContain('Hazem Ahmed');
    expect(row.textContent).toContain('·');
    expect(row.textContent).toContain('MindsDB');
    expect(row.textContent).toContain('HA'); // initials placeholder
  });

  it('keeps just the name when the account has no organization', () => {
    renderMenu(<UserMenu user={{ ...user, org: null }} theme="light" />);
    const row = screen.getByRole('button', { name: /Hazem Ahmed/ });
    expect(row.textContent).not.toContain('·');
    expect(row.textContent).not.toContain('MindsDB');
  });

  it('renders the picture as the avatar when the account carries one', () => {
    const { container } = renderMenu(
      <UserMenu user={{ ...user, picture: 'https://cdn.example.com/a.png' }} theme="light" />
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/a.png');
  });
});

describe('UserMenu — dropdown (ENG-1545 curated items)', () => {
  it('owns its open state so the footer trigger works inside Electron drag-region shells', () => {
    renderMenu(<UserMenu user={user} />);
    const trigger = screen.getByRole('button', { name: /Hazem Ahmed/ });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menuitem', { name: /Settings/ })).toBeNull();
  });

  it('heads the menu with the account and names the organization in its own section', () => {
    renderMenu(<UserMenu user={user} />);
    openMenu();
    // Same shape as the console: who you are on top, which organization below.
    expect(screen.getByText('hazem@example.com')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getAllByText('MindsDB').length).toBeGreaterThan(0);
    for (const label of ['Settings', 'Billing & Usage', 'Members', 'Help & Feedback', 'Logout']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('drops the items curated away (Profile / General / Documentation / theme toggle)', () => {
    renderMenu(<UserMenu user={user} />);
    openMenu();
    for (const label of [/^Profile$/, /^General$/, /Documentation/, /Dark mode/, /Light mode/]) {
      expect(screen.queryByRole('menuitem', { name: label })).toBeNull();
    }
  });

  it('opens Settings in-app', () => {
    const onOpenSettings = vi.fn();
    renderMenu(<UserMenu user={user} onOpenSettings={onOpenSettings} />);
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
    renderMenu(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }));
    expect(hostMock.openExternal).toHaveBeenCalledWith(url);
  });

  // On web, host.logout() ends the Keycloak browser session, so Logout is a
  // real action and the item renders on both shells.
  it('shows Logout on the web shell and runs the logout flow', () => {
    hostMock.host.isElectron = false;
    hostMock.host.isWeb = true;
    renderMenu(<UserMenu user={user} />);
    openMenu();
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ }));
    expect(screen.getByText(LOGOUT_CONFIRM_COPY.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LOGOUT_CONFIRM_COPY.confirmLabel }));
    expect(hostMock.host.logout).toHaveBeenCalled();
  });

  it('asks for confirmation before logging out, then runs the logout flow', async () => {
    renderMenu(<UserMenu user={user} />);
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
    renderMenu(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Billing & Usage/ }));
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('nav');
    expect(hostMock.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it.each([['Members'], ['Help & Feedback'], ['Settings']])(
    'records nothing for %s — it is not a billing route',
    (label) => {
      renderMenu(<UserMenu user={user} onOpenSettings={vi.fn()} />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }));
      expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
    },
  );
});

/**
 * ── Which organization this install works in ──────────────────────
 *
 * The picker is here rather than in the rail because an organization is who
 * is paying, and the account menu is the identity surface. Switching also
 * changes the tenant subsequent requests address, which is why a refusal has
 * to say something rather than leaving a row that quietly did nothing.
 */
describe('UserMenu — organization picker', () => {
  const withOrgs = (orgs, active) => {
    orgsMock.state = {
      orgs,
      activeOrg: active,
      activeOrgId: active?.id ?? null,
      switching: false,
    };
  };

  it('names the active organization from the listing, not from the token claim', () => {
    // A company organization is where the listing genuinely knows more than the
    // claim: the claim carries no display name, so without the listing there is
    // nothing to print. Kept on ACME rather than the personal organization,
    // which is the one case where the listing's own label is the wrong one.
    withOrgs([ACME, PERSONAL], ACME);
    renderMenu(<UserMenu user={{ ...user, org: null }} />);
    expect(screen.getByRole('button', { name: /Hazem Ahmed/ }).textContent)
      .toContain('acme.example');
  });

  /*
   * ENG-2109. This assertion used to read the other way — it expected
   * "hazem@example.com's organization", auth's generated label, because the
   * listing's `displayName` won unconditionally. That is what users saw: the
   * row painted `Personal` from the claim and then swapped to the long name
   * once the listing resolved.
   *
   * The pair below is the regression guard, and it has to be a pair. Either
   * render passes on its own with the bug fully present — the claim-only case
   * always said `Personal`, and asserting only the listing case would just
   * re-encode the defect. What was broken is that the two DISAGREED.
   */
  it('names a personal organization Personal before the listing lands', () => {
    withOrgs([], null);
    renderMenu(<UserMenu user={{ ...user, org: PERSONAL_LABEL }} />);
    expect(screen.getByRole('button', { name: /Hazem Ahmed/ }).textContent)
      .toContain(PERSONAL_LABEL);
  });

  it('still names it Personal after the listing lands, rather than swapping to auth\'s long label', () => {
    withOrgs([ACME, PERSONAL], PERSONAL);
    renderMenu(<UserMenu user={{ ...user, org: PERSONAL_LABEL }} />);
    const footer = screen.getByRole('button', { name: /Hazem Ahmed/ }).textContent;
    expect(footer).toContain(PERSONAL_LABEL);
    expect(footer).not.toContain("hazem@example.com's organization");
  });

  it('lists every organization with a check on the active one', () => {
    withOrgs([ACME, PERSONAL], ACME);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    const active = screen.getByRole('menuitem', { name: /acme\.example/ });
    const other = screen.getByRole('menuitem', { name: /Personal/ });
    expect(active).toHaveAttribute('data-disabled');
    expect(other).not.toHaveAttribute('data-disabled');
  });

  it('switches to the organization that was clicked', () => {
    withOrgs([ACME, PERSONAL], ACME);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Personal/ }));
    expect(orgsMock.switchOrg).toHaveBeenCalledWith('org-personal');
  });

  it('still names the only organization, and leaves nothing to switch to', () => {
    /*
     * The console shows the section for one organization too. A checked row
     * answers "which organization am I in" outright, where an absent section
     * leaves the reader to infer it from nothing. There is still no switch
     * target, so the row is disabled.
     */
    withOrgs([PERSONAL], PERSONAL);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    const only = screen.getByRole('menuitem', { name: /Personal/ });
    expect(only).toHaveAttribute('data-disabled');
  });

  it('falls back to the claim organization when the listing never arrives', () => {
    /*
     * Signed out, an older main process with no such channel, or a read still
     * in flight all land here. The section still names the organization the
     * token knows about, so only the switch targets are missing rather than
     * the whole answer.
     */
    withOrgs([], null);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /MindsDB/ })).toHaveAttribute('data-disabled');
    for (const label of ['Settings', 'Billing & Usage', 'Members', 'Help & Feedback', 'Logout']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('drops the organization section only when nothing can name one', () => {
    withOrgs([], null);
    renderMenu(<UserMenu user={{ ...user, org: null }} />);
    openMenu();
    expect(screen.queryByText('Organization')).toBeNull();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('says so when the switch is refused, and leaves the check where it was', async () => {
    orgsMock.switchOrg.mockResolvedValue({ ok: false, error: 'MindsHub would not switch. Nothing changed.' });
    withOrgs([ACME, PERSONAL], ACME);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Personal/ }));
    expect(await screen.findByText('MindsHub would not switch. Nothing changed.')).toBeInTheDocument();
    // Nothing is applied optimistically, so the trigger still names the one
    // the app is actually working in.
    expect(screen.getByRole('button', { name: /Hazem Ahmed/ }).textContent).toContain('acme.example');
  });

  it('does not render a refusal while an indeterminate web switch reloads', async () => {
    orgsMock.switchOrg.mockResolvedValue({
      ok: false,
      reloadRequired: true,
      error: 'The tenant may already have changed.',
    });
    withOrgs([ACME, PERSONAL], ACME);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Personal/ }));

    await waitFor(() => expect(orgsMock.switchOrg).toHaveBeenCalledWith('org-personal'));
    expect(screen.queryByText('The tenant may already have changed.')).toBeNull();
  });

  it('offers Manage organization only once there is an organization to manage', () => {
    withOrgs([], null);
    const { unmount } = renderMenu(<UserMenu user={{ ...user, org: null }} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /Manage organization/ })).toBeNull();
    unmount();

    withOrgs([ACME, PERSONAL], ACME);
    renderMenu(<UserMenu user={user} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Manage organization/ }));
    expect(hostMock.openExternal).toHaveBeenCalledWith(MINDS_GENERAL_URL);
  });
});
