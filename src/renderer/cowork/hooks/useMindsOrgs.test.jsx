import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  mindshubListOrgs: vi.fn(),
  mindshubSwitchOrg: vi.fn(),
}));
vi.mock('../../platform/host', () => hostMock);

const transitionMock = vi.hoisted(() => ({ prepareForOrganizationReload: vi.fn() }));
vi.mock('../lib/organizationTransition', () => transitionMock);

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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  hostMock.mindshubListOrgs.mockReset();
  hostMock.mindshubSwitchOrg.mockReset();
  transitionMock.prepareForOrganizationReload.mockReset();
  hostMock.mindshubListOrgs.mockResolvedValue({ orgs: [ACME, PERSONAL], activeOrgId: ACME.id });
});

afterEach(() => {
  vi.useRealTimers();
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

  it('hides the previous person\'s organizations while the next read is pending', async () => {
    let releaseSecond;
    hostMock.mindshubListOrgs
      .mockResolvedValueOnce({ orgs: [ACME], activeOrgId: ACME.id })
      .mockImplementationOnce(() => new Promise((resolve) => { releaseSecond = resolve; }));

    const { result, rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    await waitFor(() => expect(result.current.orgs).toEqual([ACME]));

    rerender({ user: account('user-2') });
    expect(result.current.orgs).toEqual([]);
    expect(result.current.activeOrg).toBeNull();

    await act(async () => {
      releaseSecond({ orgs: [PERSONAL], activeOrgId: PERSONAL.id });
    });
    expect(result.current.orgs).toEqual([PERSONAL]);
  });

  it('keeps the desktop switch result as local state without reloading', async () => {
    hostMock.mindshubSwitchOrg.mockResolvedValue({
      ok: true,
      activeOrgId: PERSONAL.id,
      orgs: [ACME, PERSONAL],
    });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    await act(async () => { await result.current.switchOrg(PERSONAL.id); });
    expect(result.current.activeOrg).toEqual(PERSONAL);
    expect(transitionMock.prepareForOrganizationReload).not.toHaveBeenCalled();
  });

  it('clears org-scoped caches and reloads after a successful web switch', async () => {
    hostMock.mindshubSwitchOrg.mockResolvedValue({
      ok: true,
      reloadRequired: true,
      activeOrgId: PERSONAL.id,
      orgs: [ACME, PERSONAL],
    });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    await act(async () => { await result.current.switchOrg(PERSONAL.id); });

    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledOnce();
    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledWith({
      clearTenantState: true,
    });
    /**
     * Reload is mocked, so this catches a local state update that would flash
     * the new tenant before the real page is torn down.
     */
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('clears org-scoped caches and reloads when the web switch needs recovery', async () => {
    /**
     * The organization mutation can succeed before the forced token refresh
     * fails. `ok: false` is not a definite refusal when reloadRequired is set.
     */
    hostMock.mindshubSwitchOrg.mockResolvedValue({
      ok: false,
      reloadRequired: true,
      activeOrgId: PERSONAL.id,
      orgs: [ACME, PERSONAL],
      error: 'Sign in again to finish changing organization.',
    });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    let outcome;
    await act(async () => { outcome = await result.current.switchOrg(PERSONAL.id); });

    expect(outcome.ok).toBe(false);
    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledWith({
      clearTenantState: true,
    });
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('preserves tenant state for a pre-dispatch adapter-healing reload', async () => {
    hostMock.mindshubSwitchOrg.mockResolvedValue({
      ok: false,
      reloadRequired: true,
      clearTenantState: false,
      error: 'Reload to retry.',
    });
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    await act(async () => { await result.current.switchOrg(PERSONAL.id); });

    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledWith({
      clearTenantState: false,
    });
  });

  it('honors a mandatory reload after the signed-in person changes', async () => {
    /**
     * A possibly committed tenant transition outranks the ordinary identity
     * generation guard. The replacement session must not keep an old document
     * whose server-side scope may have moved.
     */
    let releaseSwitch;
    hostMock.mindshubSwitchOrg.mockImplementation(
      () => new Promise((resolve) => { releaseSwitch = resolve; }),
    );
    const { result, rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    let pending;
    act(() => { pending = result.current.switchOrg(PERSONAL.id); });
    rerender({ user: account('user-2') });
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2));

    await act(async () => {
      releaseSwitch({ ok: true, reloadRequired: true, activeOrgId: PERSONAL.id, orgs: [PERSONAL] });
      await pending;
    });

    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledWith({
      clearTenantState: true,
    });
    expect(result.current.switching).toBe(false);
  });

  it('drops a settled desktop switch after the signed-in person changes', async () => {
    let releaseSwitch;
    hostMock.mindshubSwitchOrg.mockImplementation(
      () => new Promise((resolve) => { releaseSwitch = resolve; }),
    );
    const { result, rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    let pending;
    act(() => { pending = result.current.switchOrg(PERSONAL.id); });
    rerender({ user: account('user-2') });
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2));

    await act(async () => {
      releaseSwitch({ ok: true, activeOrgId: ACME.id, orgs: [ACME] });
      await pending;
    });

    expect(result.current.orgs).toEqual([ACME, PERSONAL]);
    expect(result.current.activeOrg).toEqual(ACME);
    expect(result.current.switching).toBe(false);
    expect(transitionMock.prepareForOrganizationReload).not.toHaveBeenCalled();
  });

  it('honors a mandatory reload after the menu unmounts', async () => {
    let releaseSwitch;
    hostMock.mindshubSwitchOrg.mockImplementation(
      () => new Promise((resolve) => { releaseSwitch = resolve; }),
    );
    const { result, unmount } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));

    let pending;
    act(() => { pending = result.current.switchOrg(PERSONAL.id); });
    unmount();
    await act(async () => {
      releaseSwitch({ ok: false, reloadRequired: true, error: 'Unconfirmed.' });
      await pending;
    });

    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledWith({
      clearTenantState: true,
    });
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
    /**
     * Nothing is applied optimistically: the host decides whether the switch
     * happened, so painting the check on a row it then refuses is how the app
     * ends up disagreeing with the organization its requests are scoped to.
     */
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
    expect(transitionMock.prepareForOrganizationReload).not.toHaveBeenCalled();
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

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    /**
     * No `reachable` field is the settled legacy/Electron contract. Retrying
     * it would make every old desktop build poll an IPC channel it cannot add.
     */
    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1);
  });

  it('stays empty while an unreachable web read is retried', async () => {
    hostMock.mindshubListOrgs
      .mockResolvedValueOnce({
        reachable: false,
        /**
         * Ignore even plausible-looking data on an answer that says it did not
         * reach the source; stale rows are worse than no organization group.
         */
        orgs: [ACME],
        activeOrgId: ACME.id,
      })
      .mockResolvedValueOnce({
        reachable: true,
        orgs: [ACME, PERSONAL],
        activeOrgId: ACME.id,
      });

    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1));
    expect(result.current.orgs).toEqual([]);
    expect(result.current.activeOrg).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2);
    expect(result.current.orgs).toEqual([ACME, PERSONAL]);
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('retries when the platform read throws', async () => {
    hostMock.mindshubListOrgs
      .mockRejectedValueOnce(new Error('temporary transport failure'))
      .mockResolvedValueOnce({ orgs: [ACME, PERSONAL], activeOrgId: ACME.id });

    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1));
    expect(result.current.orgs).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2);
    expect(result.current.activeOrg).toEqual(ACME);
  });

  it('drops a thrown read after the signed-in person changes', async () => {
    let rejectFirst;
    hostMock.mindshubListOrgs
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ orgs: [PERSONAL], activeOrgId: PERSONAL.id });

    const { result, rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    rerender({ user: account('user-2') });
    await waitFor(() => expect(result.current.activeOrg).toEqual(PERSONAL));

    await act(async () => { rejectFirst(new Error('late transport failure')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2);
    expect(result.current.activeOrg).toEqual(PERSONAL);
  });

  it('uses the bounded retry delays and then gives up', async () => {
    const calledAt = [];
    hostMock.mindshubListOrgs.mockImplementation(async () => {
      calledAt.push(Date.now());
      return { reachable: false, orgs: [], activeOrgId: null };
    });

    renderHook(() => useMindsOrgs(account('user-1')));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(4);
    expect(calledAt.slice(1).map((at, index) => at - calledAt[index]))
      .toEqual([2_000, 8_000, 30_000]);
  });

  it('cancels the retry loop when the hook unmounts', async () => {
    /**
     * Cleanup runs before this first request settles. The late answer must not
     * arm a timer after cleanup has already cleared the old timer slot.
     */
    let release;
    hostMock.mindshubListOrgs.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const { unmount } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      release({ reachable: false, orgs: [], activeOrgId: null });
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1);
  });

  it('cancels the previous identity retry when the signed-in person changes', async () => {
    hostMock.mindshubListOrgs
      .mockResolvedValueOnce({ reachable: false, orgs: [], activeOrgId: null })
      .mockResolvedValueOnce({ orgs: [PERSONAL], activeOrgId: PERSONAL.id });

    const { result, rerender } = renderHook(({ user }) => useMindsOrgs(user), {
      initialProps: { user: account('user-1') },
    });
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(1));

    rerender({ user: account('user-2') });
    await waitFor(() => expect(result.current.orgs).toEqual([PERSONAL]));

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2);
    expect(result.current.activeOrg).toEqual(PERSONAL);
  });

  it('makes refresh one attempt rather than starting another retry loop', async () => {
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(result.current.activeOrg).toEqual(ACME));
    hostMock.mindshubListOrgs.mockResolvedValue({
      reachable: false,
      orgs: [],
      activeOrgId: null,
    });

    await act(async () => { await result.current.refresh(); });
    expect(result.current.orgs).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(hostMock.mindshubListOrgs).toHaveBeenCalledTimes(2);
  });

  it('survives a malformed answer rather than rendering an undefined list', async () => {
    hostMock.mindshubListOrgs.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMindsOrgs(account('user-1')));
    await waitFor(() => expect(hostMock.mindshubListOrgs).toHaveBeenCalled());
    expect(result.current.orgs).toEqual([]);
    expect(result.current.activeOrgId).toBeNull();
  });
});
