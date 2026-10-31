// The organization's name in sharing copy ("Everyone at Acme"): read from
// the app's own organization list (useMindsOrgs' active organization), since
// cowork-server's sharing capabilities name no organization.
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
const TOKEN = `${base64url({ alg: 'none' })}.${base64url({ sub: 'user-1', email: 'me@acme.com' })}.sig`;
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

  /* A surface with sharing off reads neither the account nor the list. */
  it('reads nothing while inactive', async () => {
    const { result } = renderHook(() => useSharingOrgName(false));

    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(result.current).toBeNull();
    expect(hostMock.getAccessToken).not.toHaveBeenCalled();
    expect(hostMock.mindshubListOrgs).not.toHaveBeenCalled();
  });
});
