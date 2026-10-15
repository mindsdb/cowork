// A deployment brand's name and logo on the surfaces it covers, on a web build
// with the platform UI off. The stock text these surfaces fall back to is
// pinned by their own tests, which run with the platform UI on.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { productName: "Ada's & Co Cowork", logoUrl: '/brand/logo.svg?v=1' };
});
vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isWeb: true, isElectron: false, logout: vi.fn() } };
});
vi.mock('./lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));

import { WelcomeLoading } from '../WelcomeLoading';
import SearchModal from './components/SearchModal';
import MobileShell from './components/MobileShell';
import { LOGOUT_CONFIRM_COPY } from './hooks/useLogout';

const shellProps = { route: 'unknown', tasks: [], projects: [], scheduled: [], artifacts: [] };

describe("a deployment brand's name", () => {
  it('welcomes the user', () => {
    render(<WelcomeLoading />);
    expect(screen.getByText("Welcome to Ada's & Co Cowork")).toBeInTheDocument();
  });

  it('labels search and its empty result', async () => {
    const user = userEvent.setup();
    render(<SearchModal open onClose={vi.fn()} onSelect={vi.fn()} onSearch={vi.fn().mockResolvedValue({ results: [] })} />);
    const input = screen.getByLabelText("Search Ada's & Co Cowork");
    await user.type(input, 'nothing');
    await waitFor(() => expect(screen.getByText("No Ada's & Co Cowork results found.")).toBeInTheDocument());
  });

  it('titles the phone header and drawer, with the brand logo', () => {
    render(<MobileShell {...shellProps}>content</MobileShell>);
    expect(screen.getAllByText("Ada's & Co Cowork")).toHaveLength(2);
    expect(document.querySelector('.mshell__drawer-logo')?.getAttribute('src')).toBe('/brand/logo.svg?v=1');
  });

  it("lets a sidebar title and logo set in Settings win in the phone drawer", () => {
    render(<MobileShell {...shellProps} route="home" navTitle="Team space" navLogo="data:image/png;base64,aWNvbg==">content</MobileShell>);
    expect(screen.getByText('Team space')).toBeInTheDocument();
    expect(document.querySelector('.mshell__drawer-logo')?.getAttribute('src')).toBe('data:image/png;base64,aWNvbg==');
  });

  it('names the product when signing out', () => {
    expect(LOGOUT_CONFIRM_COPY.title).toBe("Sign out of Ada's & Co Cowork?");
    expect(LOGOUT_CONFIRM_COPY.message).toBe("This signs you out of Ada's & Co Cowork. You'll need to sign in again to keep using it.");
  });
});
