// Naming people by id, and the org directory, when MindsHub gives no answer:
// an outage is asked about again on its own, a throttle on Retry, and a
// refusal on the next open. An id cowork-server refuses as no UUID names
// nobody and is never asked about again. Driven through the real readers
// (api.js), with only HTTP mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: true }));

import { __resetOrgSharingForTests, useKnownPeople, useMindsHubTeams, useOrgDirectory } from './useOrgSharing';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
/* The bodies cowork-server's MindsHubRefused answers (its
   cowork/services/mindshub_client.py, which this app can't import). */
const refused = () => jsonRes({ detail: { code: 'mindshub_refused', message: 'MindsHub refused to answer for your organization.' } }, 403);
const throttled = () => jsonRes({ detail: { code: 'mindshub_throttled', message: 'MindsHub is limiting how often this can be asked. Try again in a minute.' } }, 429);
const ANA = { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' };

/* Past the delay after which an outage is asked about again. */
const LATER_MS = 6000;
const peopleAsked = (fetch) => fetch.mock.calls.filter(([url]) => String(url).includes('/hub/people/?ids=')).length;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  __resetOrgSharingForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useKnownPeople', () => {
  it('names an id cowork-server refuses as no UUID as an unknown person, and never asks about it again', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ code: 'invalid_id', detail: 'Each id must be a UUID.', ids: ['legacy-id'] }, 400))
      .mockResolvedValue(jsonRes({ reachable: true, people: [ANA] }));
    const { result, rerender } = renderHook(() => useKnownPeople(['u-ana', 'legacy-id']));

    await waitFor(() => expect(result.current.people[0]).toEqual(ANA));
    expect(result.current.people[1]).toEqual({ id: 'legacy-id', name: null, email: null });
    expect(result.current.failure).toBeNull();
    // The rest of the batch was asked once more, without the refused id.
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('ids')).toBe('u-ana');

    await act(async () => { vi.advanceTimersByTime(LATER_MS); });
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(peopleAsked(fetch)).toBe(2);
  });

  it('asks again a few seconds after MindsHub could not be asked', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ detail: 'boom' }, 500))
      .mockResolvedValue(jsonRes({ reachable: true, people: [ANA] }));
    const { result, rerender } = renderHook(() => useKnownPeople(['u-ana']));

    await waitFor(() => expect(result.current.failure).toBe('mindshub_unreachable'));
    expect(result.current.people[0]).toMatchObject({ id: 'u-ana', failed: true });

    await act(async () => { vi.advanceTimersByTime(LATER_MS); });
    rerender();
    await waitFor(() => expect(result.current.people[0]).toEqual(ANA));
    expect(peopleAsked(fetch)).toBe(2);
    expect(result.current.failure).toBeNull();
  });

  it('says MindsHub is limiting requests, and asks again on Retry, never on its own', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(throttled())
      .mockResolvedValue(jsonRes({ reachable: true, people: [ANA] }));
    const { result, rerender } = renderHook(() => useKnownPeople(['u-ana']));

    await waitFor(() => expect(result.current.failure).toBe('mindshub_throttled'));
    await act(async () => { vi.advanceTimersByTime(LATER_MS); });
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(peopleAsked(fetch)).toBe(1);

    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.people[0]).toEqual(ANA));
    expect(peopleAsked(fetch)).toBe(2);
  });

  it('says MindsHub refused, and asks again only on the next open', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(refused())
      .mockResolvedValue(jsonRes({ reachable: true, people: [ANA] }));
    const first = renderHook(() => useKnownPeople(['u-ana']));

    await waitFor(() => expect(first.result.current.failure).toBe('mindshub_refused'));
    expect(first.result.current.people[0]).toMatchObject({ id: 'u-ana', failed: true });
    await act(async () => { vi.advanceTimersByTime(LATER_MS); });
    first.rerender();
    await act(async () => { await Promise.resolve(); });
    expect(peopleAsked(fetch)).toBe(1);
    first.unmount();

    const next = renderHook(() => useKnownPeople(['u-ana']));
    await waitFor(() => expect(next.result.current.people[0]).toEqual(ANA));
    expect(peopleAsked(fetch)).toBe(2);
  });
});

describe('useOrgDirectory', () => {
  it.each([
    ['refused', refused, 'mindshub_refused'],
    ['throttled', throttled, 'mindshub_throttled'],
    ['unreachable', () => jsonRes({ reachable: false, people: [] }), 'mindshub_unreachable'],
  ])('says why a read of the directory failed: %s', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const { result } = renderHook(() => useOrgDirectory(true));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.failure).toBe(failure);
  });

  /* A refusal offers no Retry, so the next picker to open asks again; an
     outage waits for Retry. */
  it('asks again for a refused directory when the next picker opens, but not for an outage', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(jsonRes({ reachable: false, people: [] }))
      .mockResolvedValue(jsonRes({ reachable: true, people: [ANA], truncated: false }));
    const first = renderHook(() => useOrgDirectory(true));
    await waitFor(() => expect(first.result.current.failure).toBe('mindshub_refused'));
    first.unmount();

    const second = renderHook(() => useOrgDirectory(true));
    await waitFor(() => expect(second.result.current.failure).toBe('mindshub_unreachable'));
    second.unmount();
    expect(fetch).toHaveBeenCalledTimes(2);

    const third = renderHook(() => useOrgDirectory(true));
    await act(async () => { await Promise.resolve(); });
    expect(third.result.current.status).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says why a lookup of addresses past a capped directory got no answer', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ reachable: true, truncated: true, people: [ANA] }))
      .mockResolvedValueOnce(throttled())
      .mockResolvedValue(jsonRes({ reachable: true, people: [] }));
    const { result } = renderHook(() => useOrgDirectory(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => { result.current.lookUp(['bo@acme.com']); });
    await waitFor(() => expect(result.current.lookupFailure).toBe('mindshub_throttled'));
    expect(result.current.lookingUp).toBe(false);
    expect(result.current.addresses).toEqual({});

    // A lookup that answers clears it.
    act(() => { result.current.lookUp(['bo@acme.com']); });
    await waitFor(() => expect(result.current.addresses).toEqual({ 'bo@acme.com': null }));
    expect(result.current.lookupFailure).toBeNull();
  });

  /* A new read of a loaded list that gets no answer keeps the list, and
     says why, so an address the old list lacks is reported with the reason. */
  it.each([
    ['refused', refused, 'mindshub_refused'],
    ['throttled', throttled, 'mindshub_throttled'],
  ])('keeps the list when a new read of it is %s, and says why', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ reachable: true, truncated: false, people: [ANA] }))
      .mockResolvedValueOnce(response())
      .mockResolvedValue(jsonRes({ reachable: true, truncated: false, people: [ANA] }));
    const { result } = renderHook(() => useOrgDirectory(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.failure).toBe(failure));
    expect(result.current).toMatchObject({ status: 'ready', refreshing: false, people: [ANA] });

    // A new read that answers clears it.
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.failure).toBeNull());
    expect(result.current.status).toBe('ready');
  });
});

describe('useMindsHubTeams', () => {
  it.each([
    ['refused', refused, 'mindshub_refused'],
    ['throttled', throttled, 'mindshub_throttled'],
    ['unreachable', () => jsonRes({ reachable: false, teams: [] }), 'mindshub_unreachable'],
  ])('says why a read of the teams got no answer: %s', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const { result } = renderHook(() => useMindsHubTeams(true));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ reachable: false, failure, teams: [] });
  });

  it('says nothing failed when the teams answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ reachable: true, teams: [{ id: 't1', displayName: 'Platform' }] }));
    const { result } = renderHook(() => useMindsHubTeams(true));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ reachable: true, failure: null, teams: [{ id: 't1', display_name: 'Platform' }] });
  });
});
