// The organization's name in sharing copy ("Everyone at Acme"): read from
// the app's own organization list (useMindsOrgs' active organization), else
// from the access token's organization claim, since cowork-server's sharing
// capabilities name no organization.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  mindshubListOrgs: vi.fn(),
  mindshubSwitchOrg: vi.fn(),
  isElectron: false,
}));
vi.mock('../../platform/host', async (importOriginal) => ({ ...(await importOriginal()), ...hostMock }));

import { useSharingOrgName } from './useOrgSharing';

const base64url = (value) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const tokenWith = (claims) => `${base64url({ alg: 'none' })}.${base64url({ sub: 'user-1', email: 'me@acme.com', ...claims })}.sig`;
const TOKEN = tokenWith({});
/* What the list answers where organization switching is off: no list. */
const NO_LIST = { orgs: [], activeOrgId: null, reachable: false };
const ACME = { id: 'org-acme', name: 'acme', displayName: 'Acme Inc', isPersonal: false };
const PERSONAL = { id: 'org-me', name: 'personal_user-1', displayName: 'Personal Organization', isPersonal: true };

/* Waits until the organization list has answered and the hook has taken it. */
async function listLanded() {
  await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalled());
  await act(async () => { await hostMock.mindshubListOrgs.mock.results[0].value; });
}

beforeEach(() => {
  hostMock.getAccessToken.mockReset();
  hostMock.getAccessToken.mockResolvedValue(TOKEN);
  hostMock.mindshubListOrgs.mockReset();
  hostMock.mindshubListOrgs.mockResolvedValue({ orgs: [ACME, PERSONAL], activeOrgId: ACME.id, reachable: true });
});

describe('useSharingOrgName', () => {
  it('names the active organization from the organization list', async () => {
    const { result } = renderHook(() => useSharingOrgName(true));

    await waitFor(() => expect(result.current).toBe('Acme Inc'));
    expect(hostMock.mindshubListOrgs).toHaveBeenCalled();
  });

  it('names none for a personal organization', async () => {
    hostMock.mindshubListOrgs.mockResolvedValue({ orgs: [ACME, PERSONAL], activeOrgId: PERSONAL.id, reachable: true });
    const { result } = renderHook(() => useSharingOrgName(true));

    await listLanded();
    expect(result.current).toBeNull();
  });

  it('names none while the list names no active organization', async () => {
    hostMock.mindshubListOrgs.mockResolvedValue({ orgs: [ACME], activeOrgId: null, reachable: true });
    const { result } = renderHook(() => useSharingOrgName(true));

    await listLanded();
    expect(result.current).toBeNull();
  });

  /* Organization switching off: the list is never read, and the token's
     claim still names the organization. */
  it('names the organization from the token claim when there is no list', async () => {
    hostMock.getAccessToken.mockResolvedValue(tokenWith({ activate_organization: { id: 'org-acme', name: 'acme' } }));
    hostMock.mindshubListOrgs.mockResolvedValue(NO_LIST);
    const { result, unmount } = renderHook(() => useSharingOrgName(true));

    await waitFor(() => expect(result.current).toBe('acme'));
    unmount();
  });

  it('names none for a personal organization the token claim names', async () => {
    hostMock.getAccessToken.mockResolvedValue(tokenWith({ activate_organization: { id: 'org-me', name: 'personal_user-1' } }));
    hostMock.mindshubListOrgs.mockResolvedValue(NO_LIST);
    const { result, unmount } = renderHook(() => useSharingOrgName(true));

    await listLanded();
    expect(result.current).toBeNull();
    unmount();
  });

  /* MindsHub names an organization its staff create `staff-org-<uuid>`; the
     claim carries only that id, so the copy says "the organization". */
  it('names none for an organization the claim names only by its staff-created id', async () => {
    hostMock.getAccessToken.mockResolvedValue(tokenWith({
      activate_organization: { id: 'org-acme', name: 'staff-org-6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b' },
    }));
    hostMock.mindshubListOrgs.mockResolvedValue(NO_LIST);
    const { result, unmount } = renderHook(() => useSharingOrgName(true));

    await listLanded();
    expect(result.current).toBeNull();
    unmount();
  });

  it("prefers the list's display name over the token claim", async () => {
    hostMock.getAccessToken.mockResolvedValue(tokenWith({ activate_organization: { id: 'org-acme', name: 'acme' } }));
    const { result } = renderHook(() => useSharingOrgName(true));

    await waitFor(() => expect(result.current).toBe('Acme Inc'));
  });

  /* A surface with sharing off reads neither the account nor the list. */
  it('reads nothing while inactive', async () => {
    const { result } = renderHook(() => useSharingOrgName(false));

    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(result.current).toBeNull();
    expect(hostMock.getAccessToken).not.toHaveBeenCalled();
    expect(hostMock.mindshubListOrgs).not.toHaveBeenCalled();
  });
});
