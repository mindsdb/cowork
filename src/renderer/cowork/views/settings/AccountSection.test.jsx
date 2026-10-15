import { describe, it, expect, vi } from 'vitest';
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
vi.mock('../../hooks/useAccountUser', () => ({
  useAccountUser: () => ({ name: 'Test User', email: 'test@example.com' }),
}));
vi.mock('../../hooks/useMindsOrgs', () => ({
  useMindsOrgs: () => ({ orgs: [], activeOrg: null, activeOrgId: null, switching: false }),
}));

import AccountSection from './AccountSection';

// What desktop sign-out actually removes and keeps. Spelled out here rather than
// read from the shared copy, so a change to the wording has to change this too.
const REMOVED = 'remove the AI provider API keys saved in Cowork for this account';
const KEPT = 'connected apps and data connections, including their saved passwords';

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
