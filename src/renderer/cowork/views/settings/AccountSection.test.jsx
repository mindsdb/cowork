import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  host: {
    isWeb: false,
    isElectron: true,
    isMobileShell: false,
    isMac: () => false,
    logout: vi.fn(async () => { }),
  },
}));
vi.mock('../../../platform/host', () => hostMock);
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));
const accountMock = vi.hoisted(() => ({
  user: { name: 'Test User', email: 'test@example.com' },
  orgs: { orgs: [], activeOrg: null, activeOrgId: null, switching: false },
}));
vi.mock('../../hooks/useAccountUser', () => ({
  useAccountUser: () => accountMock.user,
}));
vi.mock('../../hooks/useMindsOrgs', () => ({
  useMindsOrgs: () => accountMock.orgs,
}));
const apiMock = vi.hoisted(() => ({
  getDeletionRequest: vi.fn(),
  requestAccountDeletion: vi.fn(),
}));
vi.mock('../../api', () => apiMock);

import AccountSection from './AccountSection';
import { MINDS_CONSOLE_HOME_URL } from '../../../lib/mindsUrls';

// What desktop sign-out actually removes and keeps. Spelled out here rather than
// read from the shared copy, so a change to the wording has to change this too.
const REMOVED = 'remove the AI provider API keys saved in Cowork for this account';
const KEPT = 'connected apps and data connections, including their saved passwords';

beforeEach(() => {
  accountMock.user = { name: 'Test User', email: 'test@example.com' };
  accountMock.orgs = { orgs: [], activeOrg: null, activeOrgId: null, switching: false };
  hostMock.host.isWeb = false;
  hostMock.host.isElectron = true;
  hostMock.host.isMobileShell = false;
  apiMock.getDeletionRequest.mockReset().mockResolvedValue(null);
  apiMock.requestAccountDeletion.mockReset();
});

function textOf(element) {
  return element.textContent.replace(/\s+/g, ' ');
}

describe('AccountSection sign-out copy', () => {
  it('describes what sign-out removes and what it keeps', () => {
    render(<AccountSection isSsoConnected />);

    const pane = textOf(document.body);
    expect(pane).toContain(`End your MindsHub session and ${REMOVED}`);
    expect(pane).toContain(KEPT);
    expect(pane).not.toContain('every stored credential');
  });

  it('says the same in the confirm dialog', () => {
    render(<AccountSection isSsoConnected />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    const dialog = textOf(screen.getByRole('dialog'));
    expect(dialog).toContain('removes the AI provider API keys saved in Cowork for this account');
    expect(dialog).toContain(KEPT);
    expect(dialog).not.toContain('stored API keys');
  });
});

describe('AccountSection console link', () => {
  // The console sends a sign-in that lands on its bare root to Cowork
  // (ENG-4288). Someone who opens the console from here meant the console, so
  // the link names its home page rather than bouncing them back.
  it('opens the console home page, not the bare root', () => {
    render(<AccountSection isSsoConnected />);

    const link = screen.getByRole('link', { name: /MindsHub/ });
    expect(link).toHaveAttribute('href', MINDS_CONSOLE_HOME_URL);
    expect(new URL(link.getAttribute('href')).pathname).toBe('/home');
  });

  // Like the account menu's console links (ENG-3274): the console opens on the
  // organization and account this pane shows, not the browser's own session.
  it('names the active organization and the account', () => {
    accountMock.user = { name: 'Test User', sub: 'user-1', orgId: 'org-from-token' };
    accountMock.orgs = { orgs: [], activeOrg: { id: 'org-listed', name: 'listed' }, activeOrgId: 'org-listed', switching: false };
    render(<AccountSection isSsoConnected />);

    const url = new URL(screen.getByRole('link', { name: /MindsHub/ }).getAttribute('href'));
    expect(`${url.origin}${url.pathname}`).toBe(MINDS_CONSOLE_HOME_URL);
    expect(url.searchParams.get('organization')).toBe('org-listed');
    expect(url.searchParams.get('subject')).toBe('user-1');
  });

  it('falls back to the token organization before the listing lands', () => {
    accountMock.user = { name: 'Test User', sub: 'user-1', orgId: 'org-from-token' };
    render(<AccountSection isSsoConnected />);

    const url = new URL(screen.getByRole('link', { name: /MindsHub/ }).getAttribute('href'));
    expect(url.searchParams.get('organization')).toBe('org-from-token');
    expect(url.searchParams.get('subject')).toBe('user-1');
  });
});

describe('AccountSection account deletion', () => {
  const OPEN_REQUEST = { requestedAt: '2026-11-17T10:00:00Z', deleteBy: '2026-12-17T10:00:00Z' };

  // Deletion is asked for inside the mobile app, which is a web build: the
  // app stores require it there. The website and desktop do not offer it.
  beforeEach(() => {
    hostMock.host.isWeb = true;
    hostMock.host.isElectron = false;
    hostMock.host.isMobileShell = true;
  });
  const STATUS = 'Deletion requested on November 17, 2026. We\'ll delete your account by December 17, 2026.';

  async function deleteButton() {
    const button = screen.getByRole('button', { name: 'Delete account' });
    // Disabled until the open-request read lands, so a returning person never
    // gets a button that their request already answered.
    await waitFor(() => expect(button).toBeEnabled());
    return button;
  }

  it('asks to confirm, sends the request, then says when the account goes', async () => {
    apiMock.requestAccountDeletion.mockResolvedValue(OPEN_REQUEST);
    render(<AccountSection isSsoConnected />);

    fireEvent.click(await deleteButton());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete your MindsHub account?')).toBeInTheDocument();
    expect(textOf(dialog)).toContain('within 30 days');
    expect(textOf(dialog)).toContain('This can\'t be undone.');
    expect(apiMock.requestAccountDeletion).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByText(STATUS)).toBeInTheDocument();
    expect(apiMock.requestAccountDeletion).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends nothing when the person cancels', async () => {
    render(<AccountSection isSsoConnected />);

    fireEvent.click(await deleteButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(apiMock.requestAccountDeletion).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows an open request instead of the button', async () => {
    apiMock.getDeletionRequest.mockResolvedValue(OPEN_REQUEST);
    render(<AccountSection isSsoConnected />);

    expect(await screen.findByText(STATUS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it.each([502, 404, 429])('keeps the button and says so when the request fails with %s', async (status) => {
    apiMock.requestAccountDeletion.mockRejectedValue(Object.assign(new Error('failed'), { status }));
    render(<AccountSection isSsoConnected />);

    fireEvent.click(await deleteButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByText('Couldn\'t send your request. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();
  });

  it('still offers the button when the open-request read fails', async () => {
    apiMock.getDeletionRequest.mockRejectedValue(Object.assign(new Error('bad gateway'), { status: 502 }));
    render(<AccountSection isSsoConnected />);

    expect(await deleteButton()).toBeInTheDocument();
  });

  it('offers no second sign-in or sign-out on web', async () => {
    render(<AccountSection isSsoConnected />);

    expect(await deleteButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it.each([['the website', true], ['desktop', false]])('does not offer the button on %s', (_host, isWeb) => {
    hostMock.host.isWeb = isWeb;
    hostMock.host.isElectron = !isWeb;
    hostMock.host.isMobileShell = false;
    render(<AccountSection isSsoConnected />);

    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
    expect(screen.queryByText(/delete your account/i)).not.toBeInTheDocument();
    expect(apiMock.getDeletionRequest).not.toHaveBeenCalled();
  });

  it.each([['the mobile app', true], ['desktop', false]])('offers nothing to delete when signed out on %s', (_host, isWeb) => {
    hostMock.host.isWeb = isWeb;
    hostMock.host.isElectron = !isWeb;
    hostMock.host.isMobileShell = isWeb;
    accountMock.user = null;
    render(<AccountSection onSsoSignIn={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
    expect(screen.queryByText(/To delete your account/)).not.toBeInTheDocument();
    expect(apiMock.getDeletionRequest).not.toHaveBeenCalled();
  });
});
