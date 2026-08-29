import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  mindshubListOrgs: vi.fn(),
  mindshubSwitchOrg: vi.fn(),
}));
vi.mock('../../platform/host', () => hostMock);

import { useMindsOrgs } from './useMindsOrgs';

const ACME = { id: 'org-acme', name: 'acme.example', displayName: 'acme.example', isPersonal: false };
const PERSONAL = {
  id: 'org-personal',
  name: 'personal_user-1',
  displayName: "hazem@example.com's organization",
  isPersonal: true,
};

const account = (sub) => ({ sub, name: 'Hazem Ahmed' });

beforeEach(() => {
  hostMock.mindshubListOrgs.mockReset();
  hostMock.mindshubSwitchOrg.mockReset();
  hostMock.mindshubListOrgs.mockResolvedValue({ orgs: [ACME, PERSONAL], activeOrgId: ACME.id });
});

describe('useMindsOrgs', () => {
  it('reads the organizations once the signed-in account resolves', async () => {
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.orgs).toHaveLength(2));
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('asks nothing while signed out', async () => {
    const { result } = renderHook(() => useMindsOrgs(null));
    await waitFor(() => expect(result.current.orgs).toEqual([]));
    expect(hostMock.mindshubListOrgs).not.toHaveBeenCalled();
  });

  it('does not re-read when the same token is decoded into a new object', async () => {
    // `useAccountUser` builds a fresh object on every resolve, so depending on
    // the object rather than the subject would re-fetch on any re-render.
    const { rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1));
    rerender({ user: account('user-1') });
    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1);
  });

  it('drops a read that resolves after the signed-in person changed', async () => {
    // Otherwise the previous account's organizations land in the new
    // account's menu, and the check sits on one they do not belong to.
    let releaseFirst;
    hostMock.mindshubListOrgs.mockImplementationOnce(
      () => new Promise((resolve) => { releaseFirst = () => resolve({ orgs: [ACME], activeOrgId: ACME.id }); }),
    );
    hostMock.mindshubListOrgs.mockResolvedValueOnce({ orgs: [PERSONAL], activeOrgId: PERSONAL.id });

    const { result, rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    rerender({ user: account('user-2') });
    await waitFor(() => expect(result.current.orgs).toEqual([PERSONAL]));

    await act(async () => { releaseFirst(); });
    expect(result.current.orgs).toEqual([PERSONAL]);
  });

  it('takes the switch result as the new state', async () => {
    hostMock.mindshubSwitchOrg.mockResolvedValue({
      ok: true,
      activeOrgId: PERSONAL.id,
      orgs: [ACME, PERSONAL],
    });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    await act(async () => { await result.current.switchOrg(PERSONAL.id); });
    expect(result.current.activeOrg).toEqual(PERSONAL);
  });

  it('keeps the organizations it already had when the switch answers without them', async () => {
    // The switch is authoritative about which organization is active; it is
    // not the only source of the list. Taking an empty `orgs` literally would
    // empty the menu on a successful switch.
    hostMock.mindshubSwitchOrg.mockResolvedValue({ ok: true, activeOrgId: PERSONAL.id, orgs: [] });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.orgs).toHaveLength(2));

    await act(async () => { await result.current.switchOrg(PERSONAL.id); });
    expect(result.current.orgs).toHaveLength(2);
    expect(result.current.activeOrg).toEqual(PERSONAL);
  });

  it('keeps the active organization when the switch answers without naming one', async () => {
    hostMock.mindshubSwitchOrg.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    await act(async () => { await result.current.switchOrg(PERSONAL.id); });
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('leaves the active organization alone when the switch is refused', async () => {
    // Nothing is applied optimistically: main decides whether the switch
    // happened, so painting the check on a row it then refuses is how the app
    // ends up disagreeing with the organization its own key belongs to.
    hostMock.mindshubSwitchOrg.mockResolvedValue({
      ok: false,
      activeOrgId: ACME.id,
      orgs: [ACME, PERSONAL],
      error: 'Nothing changed.',
    });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    let outcome;
    await act(async () => { outcome = await result.current.switchOrg(PERSONAL.id); });
    expect(outcome.error).toBe('Nothing changed.');
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('reads as no organizations when the shell is too old to answer', async () => {
    // `src/main/**` reaches people only in a new installer while the renderer
    // updates over the air, so a newer UI regularly runs against a main
    // process that has never heard of these channels. The menu then renders
    // exactly as it did before any of this existed.
    hostMock.mindshubListOrgs.mockResolvedValue({ orgs: [], activeOrgId: null });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalled());
    expect(result.current.orgs).toEqual([]);
    expect(result.current.activeOrg).toBeNull();
  });

  it('survives a malformed answer rather than rendering an undefined list', async () => {
    hostMock.mindshubListOrgs.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalled());
    expect(result.current.orgs).toEqual([]);
    expect(result.current.activeOrgId).toBeNull();
  });
});
