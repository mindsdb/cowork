import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';

// Use mutable platform/token mocks for web and signed-in footer cases.
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false, logout: async () => {} }));
const getAccessTokenMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../platform/host', () => ({
  host: hostMock,
  getAccessToken: getAccessTokenMock,
  openExternal: vi.fn(async () => {}),
}));
// Stub organization listing; menu and hook tests cover its platform routing separately.
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
// Stub workspace loading because these account-destination tests lack the API host boundary;
// workspaces have separate coverage.
vi.mock('../hooks/useHubWorkspaces', () => hubWorkspacesMock);

// Supply the real tree's Toast provider; WorkspaceSelector calls useToastManager before its early
// return.
const render = (ui, options) => rtlRender(ui, { wrapper: ToastProvider, ...options });

import Sidebar from './Sidebar';
import { deriveUpdateBanner } from '../../../shared/update-banner';

const baseProps = { tasks: [], onNavigate: () => {}, showWorkspaceSwitch: true };

// Minimal decodable JWT for the signed-in footer tests.
const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

describe('Sidebar — persistent Cowork / Code workspace switch', () => {
  it('hides the entire workspace switch until Code Mode is enabled', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} showWorkspaceSwitch={false} />);
    expect(screen.queryByRole('button', { name: 'Cowork' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
  });

  it('switches to Code from the dedicated Electron workspace control', () => {
    hostMock.isWeb = false;
    const onWorkspaceChange = vi.fn();
    render(<Sidebar {...baseProps} onWorkspaceChange={onWorkspaceChange} />);
    expect(screen.getByRole('button', { name: 'Cowork' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Code' }).click();
    expect(onWorkspaceChange).toHaveBeenCalledWith('code');
  });

  it('switches directly back to Cowork without using a Cowork navigation route', () => {
    hostMock.isWeb = false;
    const onWorkspaceChange = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        activeWorkspace="code"
        onWorkspaceChange={onWorkspaceChange}
      />
    );
    screen.getByRole('button', { name: 'Cowork' }).click();
    expect(onWorkspaceChange).toHaveBeenCalledWith('cowork');
  });

  it('gives Code first-class Projects and Connectors destinations without leaking Cowork navigation', () => {
    hostMock.isWeb = false;
    const onOpenCodingProjects = vi.fn();
    const onOpenCodingConnectors = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        activeWorkspace="code"
        onOpenCodingProjects={onOpenCodingProjects}
        onOpenCodingConnectors={onOpenCodingConnectors}
      />,
    );
    screen.getByRole('button', { name: 'Projects' }).click();
    screen.getByRole('button', { name: 'Connectors' }).click();
    expect(onOpenCodingProjects).toHaveBeenCalledOnce();
    expect(onOpenCodingConnectors).toHaveBeenCalledOnce();
    expect(screen.getByText('CODE TASKS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scheduled Tasks' })).toBeNull();
  });

  it('uses the canonical sidebar collapse control in Code', () => {
    hostMock.isWeb = false;
    const onToggleCollapsed = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        activeWorkspace="code"
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('keeps the collapse control out of the accessibility tree when unavailable', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} activeWorkspace="code" />);
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New code task' })).toBeNull();
  });

  it('does not expose local coding on the hosted web shell', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cowork' })).toBeNull();
  });
});

describe('Sidebar — Channels has no standalone entry on either platform (ENG-932)', () => {
  // Web Settings now exposes Channels; a standalone Channels row would duplicate navigation.
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
  // Keep Settings reachable on web so users can adjust reasoning effort.
  it('renders a Settings button in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens general settings (not forced to a specific section)', () => {
    // Open general Settings rather than forcing the Agent section.
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
    // The OTA "Update ready" pill never stacks under the shell banner anymore.
    expect(screen.queryByRole('button', { name: /Update ready/ })).toBeNull();
    expect(screen.getByRole('button', { name: /App update ready/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /App update ready/ }));
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

describe('Sidebar — nav title/logo override', () => {
  it('shows the default "MindsHub" wordmark and no logo when unset', () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
    expect(document.querySelector('.anton-sidebar__logo')).toBeNull();
  });

  it('shows a custom navTitle and navLogo when set', () => {
    render(<Sidebar {...baseProps} navTitle="Acme Workspace" navLogo="data:image/png;base64,abc123" />);
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
    expect(screen.queryByText('MindsHub')).toBeNull();
    const img = document.querySelector('.anton-sidebar__logo');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('falls back to "MindsHub" when navTitle is an empty string', () => {
    render(<Sidebar {...baseProps} navTitle="" />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
  });
});

describe('Sidebar — footer user menu when signed in (ENG-1408)', () => {
  // Check signed-in account footer composition separately from its signed-out Settings entry.
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

  it('shows the backend status pill instead of the account row when the server is down', async () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline={false} />);
    expect(await screen.findByRole('button', { name: /Backend status/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hazem Ahmed/ })).toBeNull();
  });
});

describe('Sidebar — recents tell loading, empty and failed apart (ENG-2246)', () => {
  // Distinguish loading, failure and empty recents so a transient read cannot look like lost tasks.
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
    // An all-pinned account is not empty even though recents excludes its tasks.
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
