import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, logout: vi.fn() },
  isElectron: false, openExternal: vi.fn(), mindshubListOrgs: vi.fn(), mindshubSwitchOrg: vi.fn(),
}));
vi.mock('../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
import UserMenu from './UserMenu';
import ToastProvider from './ui/Toast';

it('keeps identity, Settings and Logout even when an organization claim is present', () => {
  const settings = vi.fn();
  render(<ToastProvider><UserMenu
    user={{ name: 'Alice', email: 'alice@example.test', sub: 'alice', org: 'Private company' }}
    onOpenSettings={settings}
  /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Alice/ }));
  expect(screen.getByText('alice@example.test')).toBeInTheDocument();
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Settings', 'Logout']);
  expect(screen.queryByText('Private company')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
  expect(settings).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /Alice/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
});
