import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';

const hostMock = vi.hoisted(() => ({
  host: { isWeb: false, isElectron: true, isMac: () => false },
  openExternal: vi.fn(async () => {}),
}));
vi.mock('../../platform/host', () => hostMock);

// The hook is stubbed so each case is one fixed server answer. What the hook
// itself does with a real response is useHubWorkspaces.test.jsx.
const hookMock = vi.hoisted(() => ({ useHubWorkspaces: vi.fn() }));
vi.mock('../hooks/useHubWorkspaces', () => hookMock);

// The selector reports a refused switch through the toast manager, which Base UI
// requires a provider for. The real tree has one (App wraps AppCore).
const render = (ui, options) => rtlRender(ui, { wrapper: ToastProvider, ...options });

import WorkspaceSelector from './WorkspaceSelector';
import { MINDS_WORKSPACES_URL } from '../../lib/mindsUrls';

const user = { sub: 'user-1', name: 'Hazem Ahmed', org: 'MindsDB' };

const DEFAULT_WS = { id: 'ws-default', displayName: 'Default', isDefault: true, archivedAt: null, role: 'member' };
const CLIENT_A = { id: 'ws-client-a', displayName: 'Client A', isDefault: false, archivedAt: null, role: 'manager' };
const KIWIBOT = { id: 'ws-kiwibot', displayName: 'Kiwibot', isDefault: false, archivedAt: null, role: 'manager' };

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

const three = (activeId = 'ws-default') =>
  state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A, KIWIBOT], activeWorkspaceId: activeId });

const trigger = () => screen.getByRole('button', { name: /^Workspace:/ });
const openMenu = () => fireEvent.click(trigger());
// By role, not by label: Base UI labels the popup AND the group with the same
// "Workspace" text, so getByLabelText matches twice.
const menu = () => within(screen.getByRole('menu'));

beforeEach(() => {
  switchWorkspace.mockClear();
  switchWorkspace.mockImplementation(async () => {});
  hostMock.openExternal.mockClear();
  hookMock.useHubWorkspaces.mockReturnValue(state());
});

describe('WorkspaceSelector — the trigger', () => {
  it('names the active workspace without anything being opened', () => {
    // The whole reason this moved out of the account menu: the current
    // workspace has to be readable at rest.
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-client-a'));
    render(<WorkspaceSelector user={user} />);

    expect(trigger()).toBeTruthy();
    expect(trigger().textContent).toContain('Client A');
  });

  it('carries the workspace name in its accessible name, not just visually', () => {
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-kiwibot'));
    render(<WorkspaceSelector user={user} />);

    expect(screen.getByRole('button', { name: 'Workspace: Kiwibot' })).toBeTruthy();
  });

  it('shows a letter tile for the active workspace', () => {
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-kiwibot'));
    const { container } = render(<WorkspaceSelector user={user} />);

    // K on the trigger. The menu is closed, so this is the only one rendered.
    expect(container.textContent).toContain('K');
  });

  it('renders for a single workspace, where there is nothing to switch to', () => {
    // Deliberate: "which workspace am I in" is worth answering on its own. An
    // earlier revision hid the control below two workspaces and that is exactly
    // the invisibility this component exists to fix.
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: true, reachable: true, workspaces: [DEFAULT_WS], activeWorkspaceId: 'ws-default' }),
    );
    render(<WorkspaceSelector user={user} />);

    expect(screen.getByRole('button', { name: 'Workspace: Default' })).toBeTruthy();
  });

  it('falls back to the first workspace when the stored active one is not in the list', () => {
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-gone'));
    render(<WorkspaceSelector user={user} />);

    expect(trigger().textContent).toContain('Default');
  });
});

describe('WorkspaceSelector — the menu', () => {
  it('lists every workspace with a check on the active one', () => {
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-client-a'));
    render(<WorkspaceSelector user={user} />);
    openMenu();

    expect(menu().getByText('Workspace')).toBeTruthy();
    for (const name of ['Default', 'Client A', 'Kiwibot']) {
      expect(menu().getByText(name)).toBeTruthy();
    }
    const rows = menu().getAllByRole('menuitem');
    const active = rows.find((r) => r.textContent.includes('Client A'));
    const other = rows.find((r) => r.textContent.includes('Kiwibot'));
    expect(active.getAttribute('data-disabled')).not.toBeNull();
    expect(other.getAttribute('data-disabled')).toBeNull();
  });

  it('offers Manage workspaces and no create entry', () => {
    // Workspaces are created in the console. A "+ Create" here would have to
    // open a browser, which is a different promise from the one it makes.
    hookMock.useHubWorkspaces.mockReturnValue(three());
    render(<WorkspaceSelector user={user} />);
    openMenu();

    expect(menu().getByText('Manage workspaces')).toBeTruthy();
    expect(menu().queryByText(/Create workspace/i)).toBeNull();
  });

  it('opens Manage workspaces in the OS browser, at the console workspace list', () => {
    hookMock.useHubWorkspaces.mockReturnValue(three());
    render(<WorkspaceSelector user={user} />);
    openMenu();

    fireEvent.click(menu().getByText('Manage workspaces'));

    expect(hostMock.openExternal).toHaveBeenCalledWith(MINDS_WORKSPACES_URL);
    expect(MINDS_WORKSPACES_URL).toContain('/settings/workspaces');
  });

  it('switches on a click, through the server', async () => {
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-default'));
    render(<WorkspaceSelector user={user} />);
    openMenu();

    fireEvent.click(menu().getByText('Kiwibot'));

    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith('ws-kiwibot'));
  });

  it('says so when the switch is refused, instead of looking like nothing happened', async () => {
    switchWorkspace.mockRejectedValue(new Error('API /hub/workspaces/active returned 403'));
    hookMock.useHubWorkspaces.mockReturnValue(three('ws-default'));
    render(<WorkspaceSelector user={user} />);
    openMenu();

    fireEvent.click(menu().getByText('Kiwibot'));

    await waitFor(() => expect(screen.getByText(/could not switch workspace/i)).toBeTruthy());
    // Not the raw error, which names an internal route and reads like a crash.
    expect(screen.queryByText(/403/)).toBeNull();
  });

  it('disables every row while a switch is in flight', () => {
    hookMock.useHubWorkspaces.mockReturnValue({ ...three('ws-default'), switching: true });
    render(<WorkspaceSelector user={user} />);
    openMenu();

    const row = menu().getAllByRole('menuitem').find((r) => r.textContent.includes('Kiwibot'));
    expect(row.getAttribute('data-disabled')).not.toBeNull();
  });
});

describe('WorkspaceSelector — when it must not render at all', () => {
  it('with the gate off, even if workspaces came back', () => {
    hookMock.useHubWorkspaces.mockReturnValue(
      state({ enabled: false, reachable: true, workspaces: [DEFAULT_WS, CLIENT_A], activeWorkspaceId: 'ws-default' }),
    );
    const { container } = render(<WorkspaceSelector user={user} />);

    expect(container.querySelector('[data-workspace-selector]')).toBeNull();
  });

  it('when the hub could not be reached', () => {
    // No rail placeholder: reserving space for a control that may never appear
    // reads as a layout bug on every launch.
    hookMock.useHubWorkspaces.mockReturnValue(state({ enabled: true, reachable: false }));
    const { container } = render(<WorkspaceSelector user={user} />);

    expect(container.querySelector('[data-workspace-selector]')).toBeNull();
  });

  it('while the read is still in flight', () => {
    hookMock.useHubWorkspaces.mockReturnValue(state());
    const { container } = render(<WorkspaceSelector user={user} />);

    expect(container.querySelector('[data-workspace-selector]')).toBeNull();
  });
});
