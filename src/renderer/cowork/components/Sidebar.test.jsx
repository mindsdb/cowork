import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ui/Toast';

// Mutable host mock so each test can flip isWeb. getAccessToken resolves the
// token behind the footer user menu — null (signed out) unless a test sets
// one; openExternal/logout are consumed by the UserMenu the footer renders
// when signed in.
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false, logout: async () => {}, onWindowVisibility: () => () => {} }));
const getAccessTokenMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../platform/host', () => ({
  host: hostMock,
  getAccessToken: getAccessTokenMock,
  openExternal: vi.fn(async () => {}),
}));
// The footer user menu now reads the organization listing through the main
// process. Stubbed rather than served, because nothing in this file is about
// organizations; the menu and the hook each have their own test file.
vi.mock('../hooks/useMindsOrgs', () => ({
  useMindsOrgs: () => ({
    orgs: [], activeOrg: null, activeOrgId: null, switching: false,
    switchOrg: vi.fn(), refresh: vi.fn(),
  }),
}));

const hubWorkspacesMock = vi.hoisted(() => ({
  useHubWorkspaces: vi.fn(() => ({
    enabled: false,
    reachable: false,
    workspaces: [],
    activeWorkspaceId: null,
    switching: false,
    switchWorkspace: vi.fn(),
    refresh: vi.fn(),
  })),
}));
// Stubbed rather than exercised here: these tests are about the account
// destinations, and the real hook pulls in api.js, which reads host.getApiOrigin
// at module load and this file's host mock does not provide one. The workspace
// group has its own test file.
vi.mock('../hooks/useHubWorkspaces', () => hubWorkspacesMock);

// The selector ships hidden. The placement tests below turn it on
// to keep covering the code that stays behind the flag.
const workspaceFlag = vi.hoisted(() => ({ WORKSPACE_SELECTOR_ENABLED: false }));
vi.mock('../lib/workspaceSelectorFlag', () => workspaceFlag);

// WorkspaceSelector calls `useToastManager()` unconditionally, before its own
// early return, and Base UI requires a provider for it. The real tree has one
// (App wraps AppCore, and the sidebar is inside it), so wrap here too rather
// than making the component tolerate its absence.
const render = (ui, options) => rtlRender(ui, { wrapper: ToastProvider, ...options });

import Sidebar from './Sidebar';
import { deriveUpdateBanner } from '../../../shared/update-banner';
import { OWN_WORK_PROMPT } from './onboarding/steps';
import { reset as resetOnboarding } from './onboarding/onboardingStore';

const baseProps = { tasks: [], onNavigate: () => {} };

// Minimal decodable JWT for the signed-in footer tests.
const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

describe('Sidebar — Code workspace and shell controls', () => {
  it('leaves the Cowork / Code switch to the titlebar brand menu', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} activeWorkspace="code" />);
    expect(screen.queryByRole('button', { name: 'Cowork' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Cowork' })).toBeNull();
  });

  it('gives Code first-class Projects and Connectors destinations without leaking Cowork navigation', () => {
    hostMock.isWeb = false;
    const onOpenCodingProjects = vi.fn();
    const onOpenCodingTasks = vi.fn();
    const onOpenCodingConnectors = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        activeWorkspace="code"
        onOpenCodingProjects={onOpenCodingProjects}
        onOpenCodingTasks={onOpenCodingTasks}
        onOpenCodingConnectors={onOpenCodingConnectors}
      />,
    );
    screen.getByRole('button', { name: 'Projects' }).click();
    screen.getByRole('button', { name: 'All tasks' }).click();
    screen.getByRole('button', { name: 'Connectors' }).click();
    expect(onOpenCodingProjects).toHaveBeenCalledOnce();
    expect(onOpenCodingTasks).toHaveBeenCalledOnce();
    expect(onOpenCodingConnectors).toHaveBeenCalledOnce();
    expect(screen.getByText('Code tasks')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scheduled Tasks' })).toBeNull();
  });

  it('docked, heads its column with the switch and the brand, and leaves the toggle to the window', () => {
    hostMock.isWeb = false;
    const brand = { wordmark: 'MindsHub', mode: 'cowork', showSwitch: true, onChange: vi.fn() };
    const { container } = render(<Sidebar {...baseProps} brand={brand} onToggleCollapsed={vi.fn()} />);
    const head = container.querySelector('.app-sidebar__head');
    // Both sit inside the sidebar, so they open and close with it.
    expect(head.closest('aside')).not.toBeNull();
    expect(head.querySelector('[role="group"][aria-label="Workspace"]')).not.toBeNull();
    // The brand has its own row under the head, with the sidebar's width.
    const brandRow = container.querySelector('.app-brand');
    expect(head.contains(brandRow)).toBe(false);
    expect(head.nextElementSibling).toBe(brandRow);
    expect(brandRow).toHaveTextContent('MindsHub');
    expect(screen.queryByRole('button', { name: 'Close sidebar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
  });

  it('starts a task from a plain row, and opens search from the brand row', () => {
    hostMock.isWeb = false;
    const onNewTask = vi.fn();
    const onOpenSearch = vi.fn();
    const brand = { wordmark: 'MindsHub', mode: 'cowork', showSwitch: false, onChange: vi.fn(), onOpenSearch, searchShortcut: '⌘K' };
    const { container } = render(<Sidebar {...baseProps} brand={brand} onNewTask={onNewTask} />);
    const newTask = screen.getByRole('button', { name: 'New task' });
    // A nav row like the others, not a filled button.
    expect(newTask).toHaveClass('nav-item');
    expect(newTask).not.toHaveClass('btn');
    fireEvent.click(newTask);
    expect(onNewTask).toHaveBeenCalledOnce();
    const search = screen.getByRole('button', { name: 'Search' });
    expect(container.querySelector('.app-brand').contains(search)).toBe(true);
    fireEvent.click(search);
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it('hosts the attention slot in the brand row only while docked', () => {
    hostMock.isWeb = false;
    const brand = { wordmark: 'MindsHub', stockMark: true, mode: 'cowork', showSwitch: false, onChange: vi.fn() };
    const { container, rerender } = render(<Sidebar {...baseProps} brand={brand} />);
    expect(container.querySelector('.app-brand .app-brand__attention')).not.toBeNull();
    expect(container.querySelector('.app-brand__mark')).not.toBeNull();
    // As a drawer or hidden, the titlebar keeps it.
    rerender(<Sidebar {...baseProps} brand={brand} popout onToggleCollapsed={vi.fn()} />);
    expect(container.querySelector('.app-brand__attention')).toBeNull();
    rerender(<Sidebar {...baseProps} brand={brand} collapsed />);
    expect(container.querySelector('.app-brand__attention')).toBeNull();
  });

  it('holds the bell\'s spot with a disabled bell only where Code is available', () => {
    hostMock.isWeb = false;
    const brand = { wordmark: 'MindsHub', stockMark: true, mode: 'cowork', showSwitch: true, onChange: vi.fn() };
    const { rerender } = render(<Sidebar {...baseProps} brand={brand} />);
    const bell = screen.getByRole('button', { name: 'Notifications, for Code tasks' });
    expect(bell).toHaveAttribute('aria-disabled', 'true');
    rerender(<Sidebar {...baseProps} brand={{ ...brand, showSwitch: false }} />);
    expect(screen.queryByRole('button', { name: 'Notifications, for Code tasks' })).toBeNull();
  });

  it('as a drawer, repeats the close toggle in its own top row', () => {
    hostMock.isWeb = false;
    const onToggleCollapsed = vi.fn();
    render(<Sidebar {...baseProps} popout onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('removes every sidebar control from the accessibility tree while collapsed', () => {
    hostMock.isWeb = false;
    const { container } = render(
      <Sidebar
        {...baseProps}
        activeWorkspace="code"
        collapsed
        onToggleCollapsed={vi.fn()}
      />,
    );
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: 'New code task' })).toBeNull();
  });

  it('docks display settings in the footer when enabled', () => {
    hostMock.isWeb = true;
    const onClick = vi.fn();
    const { rerender } = render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Display settings' })).toBeNull();
    rerender(<Sidebar {...baseProps} displayToggle={{ label: 'Display settings', icon: null, onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Sidebar — Channels has no standalone entry on either platform (ENG-932)', () => {
  // ENG-720 gave web a standalone Channels row *because* the web shell hid
  // Settings entirely, and Channels lives under Settings. ENG-932 makes
  // Settings reachable on web, so the workaround is removed — shipping both
  // would leave web with two ways in and desktop with one.
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('does not render a standalone Channels nav item in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Channels' })).toBeNull();
  });

  it('does not render one in the Electron build either (reachable via Settings)', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Channels' })).toBeNull();
  });
});

describe('Sidebar — Settings is reachable on web (ENG-932)', () => {
  // The web shell hid the whole Settings entry point, which also hid the
  // reasoning-effort control — the only user-side workaround for a turn that
  // burns its entire output budget and returns nothing (ENG-1042). A hosted
  // user hitting that had no recourse at all.
  it('renders a Settings button in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens general settings (not forced to a specific section)', () => {
    // Was: forced straight to 'settings:agent'. The Agent section (where
    // reasoning effort lives) is still one click away via Settings' own
    // nav — this button is just a general entry point now, not an
    // Agent-specific shortcut.
    const onNavigate = vi.fn();
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Settings' }).click();
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('still renders Settings on Electron when the server is healthy', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('keeps the backend status pill Electron-only when the server is down', () => {
    // The pill reports on a locally-controllable server, which web does not
    // have — but its absence must not take Settings down with it.
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} serverOnline={false} />);
    expect(screen.queryByRole('button', { name: /Backend status/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('Sidebar — the single update banner (consolidated, shell-first)', () => {
  beforeEach(() => {
    hostMock.isWeb = false;
  });

  // Which-banner-wins is covered in update-banner.test.ts; these assert the
  // sidebar renders one banner and wires its action/dismiss to the callback.
  const bannerFor = (input) => deriveUpdateBanner(input);

  it('renders the OTA "Update ready" (restart) banner and fires apply-ota', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ ota: { phase: 'available', version: '1.2.3' } })}
        onUpdateAction={onUpdateAction}
      />
    );
    const btn = screen.getByRole('button', { name: /Update ready/ });
    expect(screen.queryByRole('button', { name: /New version available/ })).toBeNull();
    fireEvent.click(btn);
    expect(onUpdateAction).toHaveBeenCalledWith('apply-ota');
  });

  it('renders the dismissible manual installer notice and fires download + dismiss', () => {
    const onUpdateAction = vi.fn();
    const onDismissUpdate = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellManual: { version: '2.0.0' } })}
        onUpdateAction={onUpdateAction}
        onDismissUpdate={onDismissUpdate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /New version available/ }));
    expect(onUpdateAction).toHaveBeenCalledWith('download-installer');
    fireEvent.click(screen.getByRole('button', { name: /Dismiss update notice/ }));
    expect(onDismissUpdate).toHaveBeenCalledTimes(1);
  });

  it('names apt in the manual notice hint on linux, narrowed to the offered version', async () => {
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellManual: { version: '2.0.0', debInstaller: true } })}
        onUpdateAction={vi.fn()}
        onDismissUpdate={vi.fn()}
      />
    );
    await userEvent.hover(screen.getByRole('button', { name: /New version available/ }));
    expect(await screen.findByText(/run sudo apt install \.\/mindshub-cowork-2\.0\.0\*\.deb from the directory you downloaded it to/)).toBeInTheDocument();
  });

  it('keeps the "open it" hint off linux', async () => {
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellManual: { version: '2.0.0', debInstaller: false } })}
        onUpdateAction={vi.fn()}
        onDismissUpdate={vi.fn()}
      />
    );
    await userEvent.hover(screen.getByRole('button', { name: /New version available/ }));
    expect(await screen.findByText(/open it to update/)).toBeInTheDocument();
  });

  it('shows exactly one banner (shell-first) when OTA and a shell update both pend', () => {
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({
          ota: { phase: 'available', version: '1.2.3' },
          shellAuto: { phase: 'ready-to-install' },
        })}
        onUpdateAction={vi.fn()}
      />
    );
    // Both ready banners read "Update ready"; the shell's says "Restart now".
    const pills = screen.getAllByRole('button', { name: /Update ready/ });
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent(/Restart now/);
    expect(pills[0]).not.toHaveTextContent('1.2.3');
  });

  it('surfaces a labelled retry when an OTA apply failed (does not go silent)', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ ota: { phase: 'error', version: '1.2.3' } })}
        onUpdateAction={onUpdateAction}
      />
    );
    const retry = screen.getByRole('button', { name: /Update failed/ });
    expect(retry).toHaveTextContent(/Try again/);
    fireEvent.click(retry);
    expect(onUpdateAction).toHaveBeenCalledWith('apply-ota');
  });

  it('renders the shell auto-update ready banner and fires shell-auto', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellAuto: { phase: 'ready-to-install' } })}
        onUpdateAction={onUpdateAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Update ready.*Restart now/ }));
    expect(onUpdateAction).toHaveBeenCalledWith('shell-auto');
  });

  it('renders an in-flight download as a disabled banner with no action', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellAuto: { phase: 'downloading', progress: { percent: 42 } } })}
        onUpdateAction={onUpdateAction}
      />
    );
    const btn = screen.getByRole('button', { name: /Downloading update/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onUpdateAction).not.toHaveBeenCalled();
  });

  it('renders no banner when nothing is pending', () => {
    render(<Sidebar {...baseProps} serverOnline updateBanner={bannerFor({})} />);
    expect(screen.queryByRole('button', { name: /Update ready|New version available|App update/ })).toBeNull();
  });
});


describe('Sidebar — footer user menu when signed in (ENG-1408)', () => {
  // Parity with the web console: a signed-in user gets the account row
  // (avatar + name · org + menu) instead of the bare Settings row. Settings
  // moves inside the menu, but the quick theme + 8-bit toggles stay in the
  // footer (ENG-1545) — restored from the menu-only placement ENG-1408 used.
  beforeEach(() => {
    getAccessTokenMock.mockResolvedValue(
      jwt({ name: 'Hazem Ahmed', email: 'hazem@example.com', active_organization: { displayName: 'MindsDB' } })
    );
  });

  afterEach(() => {
    getAccessTokenMock.mockResolvedValue(null);
  });

  it('replaces the Settings row with the account row', async () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    const row = await screen.findByRole('button', { name: /Hazem Ahmed/ });
    expect(row.textContent).toContain('MindsDB');
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('keeps the plain Settings row when signed out', async () => {
    getAccessTokenMock.mockResolvedValue(null);
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('offers Settings only through the account menu', async () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    await screen.findByRole('button', { name: /Hazem Ahmed/ });
    expect(screen.queryByRole('button', { name: /Settings/ })).toBeNull();
  });

  it('keeps display settings in the footer beside the account row', async () => {
    hostMock.isWeb = false;
    const onClick = vi.fn();
    render(<Sidebar {...baseProps} serverOnline displayToggle={{ label: 'Display settings', icon: null, onClick }} />);
    await screen.findByRole('button', { name: /Hazem Ahmed/ });
    fireEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps the account row under the backend status pill when the server is down', async () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline={false} />);
    expect(await screen.findByRole('button', { name: /Backend status/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Hazem Ahmed/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Settings/ })).toBeNull();
  });
});

describe('Sidebar — where the MindsHub workspace control sits', () => {
  // Two things are pinned here that the component's own tests cannot see: that
  // the control is drawn from the bottom of the rail rather than the top, and
  // that a one-workspace organization gets nothing in either shell.
  //
  // The signed-in token matters. The render site sits behind the resolved
  // account user, so a signed-out sidebar draws no control whatever the
  // threshold does, and every assertion below would pass for the wrong reason.
  const withWorkspaces = (workspaces) =>
    hubWorkspacesMock.useHubWorkspaces.mockReturnValue({
      enabled: true,
      reachable: true,
      workspaces,
      activeWorkspaceId: 'ws-default',
      switching: false,
      switchWorkspace: vi.fn(),
      refresh: vi.fn(),
    });

  const DEFAULT_WS = { id: 'ws-default', displayName: 'Default', isDefault: true, archivedAt: null, role: 'member' };
  const CLIENT_A = { id: 'ws-client-a', displayName: 'Client A', isDefault: false, archivedAt: null, role: 'manager' };

  beforeEach(() => {
    workspaceFlag.WORKSPACE_SELECTOR_ENABLED = true;
    getAccessTokenMock.mockResolvedValue(
      jwt({ name: 'Hazem Ahmed', email: 'hazem@example.com', active_organization: { displayName: 'MindsDB' } })
    );
  });

  afterEach(() => {
    workspaceFlag.WORKSPACE_SELECTOR_ENABLED = false;
    getAccessTokenMock.mockResolvedValue(null);
    // Back to the file's resting answer. Nothing below this block mentions
    // workspaces, so a leaked `mockReturnValue` would quietly hand them a
    // rendered control and they would never say why they changed.
    hubWorkspacesMock.useHubWorkspaces.mockReturnValue({
      enabled: false,
      reachable: false,
      workspaces: [],
      activeWorkspaceId: null,
      switching: false,
      switchWorkspace: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it('draws nothing while the selector is switched off', async () => {
    workspaceFlag.WORKSPACE_SELECTOR_ENABLED = false;
    withWorkspaces([DEFAULT_WS, CLIENT_A]);
    const { container } = render(<Sidebar {...baseProps} serverOnline />);
    await screen.findByRole('button', { name: /Hazem Ahmed/ });

    expect(container.querySelector('[data-workspace-selector]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull();
  });

  it('draws it below the New task CTA, against the footer', async () => {
    hostMock.isWeb = false;
    withWorkspaces([DEFAULT_WS, CLIENT_A]);
    const { container } = render(<Sidebar {...baseProps} serverOnline />);
    await screen.findByRole('button', { name: /Hazem Ahmed/ });

    const cta = container.querySelector('.anton-sidebar__cta-wrap');
    const wrap = container.querySelector('.anton-sidebar__workspace-wrap');
    expect(wrap).toBeTruthy();
    expect(cta.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wrap.nextElementSibling.className).toContain('anton-sidebar__footer');
  });

  it.each([
    ['desktop', false],
    ['web', true],
  ])('keeps keyboard focus in the footer when the workspace control disappears on %s', async (_shell, isWeb) => {
    hostMock.isWeb = isWeb;
    withWorkspaces([DEFAULT_WS, CLIENT_A]);
    const { rerender } = render(<Sidebar {...baseProps} serverOnline />);
    const trigger = await screen.findByRole('button', { name: 'Workspace: Default' });
    trigger.focus();

    withWorkspaces([DEFAULT_WS]);
    rerender(<Sidebar {...baseProps} serverOnline />);

    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Hazem Ahmed/ })).toHaveFocus();
  });

  it.each([
    ['desktop', false],
    ['web', true],
  ])('draws nothing for a one-workspace organization on %s', async (_shell, isWeb) => {
    hostMock.isWeb = isWeb;
    withWorkspaces([DEFAULT_WS]);
    const { container } = render(<Sidebar {...baseProps} serverOnline />);
    await screen.findByRole('button', { name: /Hazem Ahmed/ });

    expect(container.querySelector('[data-workspace-selector]')).toBeNull();
    expect(screen.queryByText('Default')).toBeNull();
  });
});

describe('Sidebar — recents tell loading, empty and failed apart (ENG-2246)', () => {
  // Before this, all three rendered as an unexplained blank list: `tasks`
  // started as `[]` with no status, and a failed fetch was collapsed to `[]`
  // too. A returning user reads an empty sidebar as lost work, not as a wait.
  it('shows skeleton rows, and no empty-state copy, while loading', () => {
    render(<Sidebar {...baseProps} tasksStatus="loading" />);
    expect(screen.getByLabelText('Loading tasks')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    expect(screen.queryByText(/Couldn’t load your tasks/)).toBeNull();
  });

  it('shows the empty state only once the fetch has succeeded', () => {
    render(<Sidebar {...baseProps} tasksStatus="ready" />);
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
  });

  it('shows a distinct failure with a retry, never the empty state', () => {
    const onRetryTasks = vi.fn();
    render(<Sidebar {...baseProps} tasksStatus="failed" onRetryTasks={onRetryTasks} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetryTasks).toHaveBeenCalledTimes(1);
  });

  it('never claims "no tasks" to a user whose tasks are all pinned', () => {
    // recents deliberately excludes pinned items, so keying the empty state on
    // it told an all-pinned user they had nothing — with their pinned tasks
    // visible directly above.
    const t = { id: 'p1', title: 'Pinned thing', messages: [], updatedAt: '2026-09-02T10:00:00Z' };
    const pins = [{ item_type: 'conversation', item_id: 'p1' }];
    render(<Sidebar {...baseProps} tasks={[t]} pins={pins} tasksStatus="ready" />);
    expect(screen.getByText('Pinned thing')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
  });

  it('shows no skeleton while loading if pinned tasks are already on screen', () => {
    const t = { id: 'p1', title: 'Pinned thing', messages: [], updatedAt: '2026-09-02T10:00:00Z' };
    const pins = [{ item_type: 'conversation', item_id: 'p1' }];
    render(<Sidebar {...baseProps} tasks={[t]} pins={pins} tasksStatus="loading" />);
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
  });

  it('never shows loading or empty copy once tasks exist', () => {
    const tasks = [{ id: 't1', title: 'Real task', messages: [], updatedAt: '2026-09-02T10:00:00Z' }];
    render(<Sidebar {...baseProps} tasks={tasks} tasksStatus="loading" />);
    expect(screen.getByText('Real task')).toBeTruthy();
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
    expect(screen.queryByText('No tasks yet')).toBeNull();
  });
});

describe('Sidebar — says why other work is missing (ENG-2169)', () => {
  // Web and desktop look the same but keep separate work, so an empty
  // task list points at the other app.
  afterEach(() => {
    getAccessTokenMock.mockResolvedValue(null);
    hostMock.isWeb = true;
  });

  it('on web, an empty task list points at the desktop app', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} tasksStatus="ready" />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(screen.getByText('Tasks made in the desktop app stay there.')).toBeInTheDocument();
  });

  it('on desktop, an empty task list points at the web app', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline tasksStatus="ready" />);
    expect(screen.getByText('Tasks made in the web app stay there.')).toBeInTheDocument();
  });

  it('says nothing about the other app while loading, after a failure, or once there are tasks', () => {
    hostMock.isWeb = false;
    const { unmount } = render(<Sidebar {...baseProps} serverOnline tasksStatus="loading" />);
    expect(screen.queryByText(/stay there/)).toBeNull();
    unmount();
    const failed = render(<Sidebar {...baseProps} serverOnline tasksStatus="failed" />);
    expect(screen.queryByText(/stay there/)).toBeNull();
    failed.unmount();
    render(<Sidebar {...baseProps} serverOnline tasksStatus="ready" tasks={[{ id: 't1', title: 'Real task', messages: [] }]} />);
    expect(screen.queryByText(/stay there/)).toBeNull();
  });
});

describe('Sidebar — onboarding checklist rows', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetOnboarding();
    hostMock.isWeb = true;
  });

  it('starts a chat from the first step and opens Home from the example row', async () => {
    const onStartChat = vi.fn().mockResolvedValue(true);
    const onOpenExamples = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar {...baseProps} onStartChat={onStartChat} onOpenExamples={onOpenExamples} />);

    await user.click(screen.getByText('Try an example'));
    expect(onOpenExamples).toHaveBeenCalledTimes(1);
    expect(onStartChat).not.toHaveBeenCalled();

    await user.click(screen.getByText('Start with your own work'));
    expect(onStartChat).toHaveBeenCalledWith(OWN_WORK_PROMPT);
  });
});

describe('Sidebar — running dot survives a reload (ENG-3939)', () => {
  // After Cmd+R the tasks come back without their `_streaming` placeholder,
  // which only returns once the task is opened and re-attaches. The server's
  // in-flight list is fetched at boot, so the dot must follow it too.
  const task = { id: 't1', title: 'Sleeping task', messages: [], updatedAt: '2026-11-02T10:00:00Z' };

  it('shows the running dot for a task the server lists as in flight', () => {
    render(<Sidebar {...baseProps} tasks={[task]} tasksStatus="ready" inFlightIds={new Set(['t1'])} />);
    expect(screen.getByLabelText('Active')).toBeTruthy();
  });

  it('still shows it for a task this window is streaming', () => {
    const streaming = { ...task, messages: [{ role: '_streaming' }] };
    render(<Sidebar {...baseProps} tasks={[streaming]} tasksStatus="ready" />);
    expect(screen.getByLabelText('Active')).toBeTruthy();
  });

  it('shows no dot when neither signal says the task is running', () => {
    render(<Sidebar {...baseProps} tasks={[task]} tasksStatus="ready" inFlightIds={new Set(['other'])} />);
    expect(screen.queryByLabelText('Active')).toBeNull();
  });
});

describe('Sidebar — task row titles', () => {
  const task = { id: 't1', title: 'A task title long enough to reach the end of the row', updatedAt: new Date().toISOString(), messages: [] };
  const titleOf = () => screen.getByRole('button', { name: task.title }).querySelector('.recent-row__title');

  it('fades the title out early only while the menu button floats over its end', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} tasks={[task]} tasksStatus="ready" />);
    expect(titleOf()).not.toHaveClass('is-clipped');
    fireEvent.mouseEnter(screen.getByRole('button', { name: task.title }).parentElement);
    expect(titleOf()).toHaveClass('is-clipped');
  });

  it('leaves the title alone when a timestamp already holds the row end', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} tasks={[task]} tasksStatus="ready" showCounters />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: task.title }).parentElement);
    expect(titleOf()).not.toHaveClass('is-clipped');
  });
});

// App decides whether the build offers Compare Models (compareAvailable); the
// entry follows it.
describe('Sidebar — Compare models entry', () => {
  it.each([[true], [false]])('is shown when App offers it: %s', (shown) => {
    render(<Sidebar {...baseProps} showCompare={shown} />);
    expect(!!screen.queryByRole('button', { name: 'Compare Models' })).toBe(shown);
  });
});

describe('Sidebar — Compare models', () => {
  it('sits in the Agent group and opens the compare route', () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...baseProps} showCompare onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Compare Models' }).click();
    expect(onNavigate).toHaveBeenCalledWith('compare');
  });
});
