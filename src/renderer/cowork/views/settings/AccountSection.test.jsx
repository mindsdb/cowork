import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  host: {
    isWeb: false,
    isElectron: true,
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

import AccountSection from './AccountSection';
import { MINDS_CONSOLE_HOME_URL } from '../../../lib/mindsUrls';

// What desktop sign-out actually removes and keeps. Spelled out here rather than
// read from the shared copy, so a change to the wording has to change this too.
const REMOVED = 'remove the AI provider API keys saved in Cowork for this account';
const KEPT = 'connected apps and data connections, including their saved passwords';

beforeEach(() => {
  accountMock.user = { name: 'Test User', email: 'test@example.com' };
  accountMock.orgs = { orgs: [], activeOrg: null, activeOrgId: null, switching: false };
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
