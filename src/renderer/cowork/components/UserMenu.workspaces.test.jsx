import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';

const hostMock = vi.hoisted(() => ({
  host: { isWeb: false, isElectron: true, isMac: () => false, logout: vi.fn(async () => {}) },
  openExternal: vi.fn(async () => {}),
}));
vi.mock('../../platform/host', () => hostMock);
vi.mock('../lib/analytics', () => ({
  resetDeviceIdentity: vi.fn(),
  trackBillingOpened: vi.fn(),
}));

// The hook is stubbed so each case is one fixed server answer. What the hook
// itself does with a real response is useHubWorkspaces.test.jsx.
const hookMock = vi.hoisted(() => ({ useHubWorkspaces: vi.fn() }));
vi.mock('../hooks/useHubWorkspaces', () => hookMock);

const render = (ui, options) => rtlRender(ui, { wrapper: ToastProvider, ...options });

import UserMenu from './UserMenu';

const user = {
  name: 'Hazem Ahmed',
  email: 'hazem@example.com',
  username: 'hazem',
  org: 'MindsDB',
  picture: null,
  sub: 'user-1',
};

const DEFAULT_WS = { id: 'ws-default', displayName: 'Default', isDefault: true, archivedAt: null, role: 'member' };
const CLIENT_A = { id: 'ws-client-a', displayName: 'Client A', isDefault: false, archivedAt: null, role: 'manager' };

const switchWorkspace = vi.fn(async () => {});

function state(overrides = {}) {
  return {
    enabled: false,
    reachable: false,
    workspaces: [],
    activeWorkspaceId: null,
    switching: false,
    switchWorkspace,
    refresh: vi.fn(),
    ...overrides,
  };
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Hazem Ahmed/ }));

beforeEach(() => {
  switchWorkspace.mockClear();
  switchWorkspace.mockImplementation(async () => {});
  hookMock.useHubWorkspaces.mockReturnValue(state());
});

describe('UserMenu — the Workspace group', () => {
  it('lists the workspaces under the org name, with a check on the active one', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();

    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('Client A')).toBeTruthy();

    // The active row is the disabled one: it is not a destination.
    const rows = screen.getAllByRole('menuitem');
    const active = rows.find((row) => row.textContent.includes('Default'));
    const other = rows.find((row) => row.textContent.includes('Client A'));
    expect(active.getAttribute('data-disabled')).not.toBeNull();
    expect(other.getAttribute('data-disabled')).toBeNull();
  });

  it('sits above Settings, so the group reads as part of the identity block', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    const { container } = render(<UserMenu user={user} />);
    openMenu();

    const text = container.ownerDocument.body.textContent;
    expect(text.indexOf('Workspace')).toBeLessThan(text.indexOf('Settings'));
  });

  it('offers no way to create a workspace: that is the console\'s job', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();

    expect(screen.queryByText(/Create workspace/i)).toBeNull();
  });

  it('renders a letter tile per row', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();

    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.getByText('C')).toBeTruthy();
  });

  it('switches on a click, through the server', async () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();

    fireEvent.click(screen.getByText('Client A'));

    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith('ws-client-a'));
  });

  it('says so when the switch is refused, instead of looking like nothing happened', async () => {
    // Nothing is applied optimistically, so a refusal leaves the check where it
    // was. Without a message that is indistinguishable from a dead menu item.
    switchWorkspace.mockRejectedValue(new Error('API /hub/workspaces/active returned 403'));
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();

    fireEvent.click(screen.getByText('Client A'));

    await waitFor(() => expect(screen.getByText(/could not switch workspace/i)).toBeTruthy());
    // Not the raw error, which reads like a crash and names an internal route.
    expect(screen.queryByText(/403/)).toBeNull();
  });

  it('disables every row while a switch is in flight', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default', switching: true }),
    );
    render(<UserMenu user={user} />);
    openMenu();

    const other = screen.getAllByRole('menuitem').find((row) => row.textContent.includes('Client A'));
    expect(other.getAttribute('data-disabled')).not.toBeNull();
  });
});

describe('UserMenu — when the group must not appear', () => {
  const unchanged = () => {
    // Scoped to the popup: the org name is also on the trigger button outside
    // it, so an unscoped query matches twice and fails on the wrong thing.
    const menu = within(screen.getByLabelText('Account'));
    // The org header and the five curated destinations, exactly as before.
    expect(menu.getByText('MindsDB')).toBeTruthy();
    expect(menu.getByText('Settings')).toBeTruthy();
    expect(menu.getByText('Billing & Usage')).toBeTruthy();
    expect(menu.getByText('Members')).toBeTruthy();
    expect(menu.getByText('Help & Feedback')).toBeTruthy();
    expect(menu.getByText('Logout')).toBeTruthy();
    expect(menu.queryByText('Workspace')).toBeNull();
    // Five menu items is the menu as it shipped: the org header is a group
    // label and the divider is a separator, so neither counts. The count guards
    // against the group appearing under some label this helper does not name.
    expect(menu.getAllByRole('menuitem')).toHaveLength(5);
  };

  it('with the gate off, even if workspaces came back', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: false, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();
    unchanged();
  });

  it('with one workspace, because there is nowhere to switch to', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS], activeWorkspaceId: 'ws-default' }),
    );
    render(<UserMenu user={user} />);
    openMenu();
    unchanged();
  });

  it('when the hub could not be reached, because a menu is the wrong place for an outage', () => {
    hookMock.useHubWorkspaces.mockReturnValue(state({ enabled: true, reachable: false }));
    render(<UserMenu user={user} />);
    openMenu();
    unchanged();
  });

  it('while the read is still in flight', () => {
    hookMock.useHubWorkspaces.mockReturnValue(state());
    render(<UserMenu user={user} />);
    openMenu();
    unchanged();
  });
});
