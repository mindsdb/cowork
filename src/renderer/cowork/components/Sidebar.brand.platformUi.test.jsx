import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';

// A deployment brand's name and logo in the sidebar's head row, on a web
// build with the platform UI off. Sidebar.test.jsx keeps the stock wordmark.
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { productName: 'Acme Cowork', logoUrl: '/brand/logo.svg?v=1' };
});
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));

// The same stubs as Sidebar.test.jsx. getAccessToken resolves the
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

// WorkspaceSelector calls `useToastManager()` unconditionally, before its own
// early return, and Base UI requires a provider for it. The real tree has one
// (App wraps AppCore, and the sidebar is inside it), so wrap here too rather
// than making the component tolerate its absence.
const render = (ui, options) => rtlRender(ui, { wrapper: ToastProvider, ...options });

import Sidebar from './Sidebar';
import { navBrand } from '../../lib/navBranding';
const baseProps = { tasks: [], onNavigate: () => {}, showWorkspaceSwitch: true };

describe('Sidebar — deployment brand', () => {
  it("shows the brand's name and logo", () => {
    render(<Sidebar {...baseProps} tasksStatus="ready" brand={navBrand(null, null)} />);
    expect(document.querySelector('.anton-sidebar__wordmark')?.textContent).toBe('Acme Cowork');
    expect(document.querySelector('.anton-sidebar__logo')?.getAttribute('src')).toBe('/brand/logo.svg?v=1');
  });

  it('lets a sidebar title and logo set in Settings win', () => {
    render(<Sidebar {...baseProps} tasksStatus="ready" brand={navBrand('Team space', 'data:image/png;base64,aWNvbg==')} />);
    expect(document.querySelector('.anton-sidebar__wordmark')?.textContent).toBe('Team space');
    expect(document.querySelector('.anton-sidebar__logo')?.getAttribute('src')).toBe('data:image/png;base64,aWNvbg==');
  });
});
