// useVersionHistory against a mocked docs API: the list, a version looked at,
// stepping, restoring and undoing it, and answers that land too late.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('./docApi');

import * as api from './docApi';
import { RESTORED_SHOWN_MS, useVersionHistory } from './useVersionHistory';

const LIST = {
  current: { rev: 12, at: '2026-10-23T16:03:00Z', by: 'user', summary: 'Budget: Retargeting 40 → 32' },
  versions: [
    { rev: 9, at: '2026-10-23T15:48:00Z', by: 'user', summary: 'Budget: added row “Podcast ads”' },
    { rev: 7, at: '2026-10-23T14:58:00Z', by: 'agent', summary: 'Added the Risks tab' },
    { rev: 2, at: '2026-10-22T11:04:00Z', by: 'agent', summary: 'First draft · 4 tabs' },
  ],
};
const versionDoc = (rev) => ({ id: 'a1', rev, tabs: [{ id: 't_1', title: 'Overview', blocks: [] }] });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(props = {}) {
  const onError = vi.fn();
  const hook = renderHook((p) => useVersionHistory({ projectRef: 'p1', artifactId: 'a1', onError, ...p }), { initialProps: props });
  return { ...hook, onError };
}

beforeEach(() => {
  api.resetDocApi();
  api.fetchDocHistory.mockResolvedValue(LIST);
  api.fetchDocVersion.mockImplementation(async (_p, _a, rev) => versionDoc(rev));
  api.restoreDocVersion.mockResolvedValue({ doc: versionDoc(13), replacedRev: 12 });
});
afterEach(() => { vi.useRealTimers(); });

describe('the list', () => {
  it('is asked for when wanted, and says when it could not be had', async () => {
    const { result } = setup();
    expect(result.current.list).toBeNull();
    await act(() => result.current.load());
    expect(result.current.list).toEqual(LIST);
    api.fetchDocHistory.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.load());
    expect(result.current.list).toEqual({ failed: true });
  });
});

describe('a version looked at', () => {
  it('opens read-only, steps older and newer, and closes', async () => {
    const { result } = setup();
    await act(() => result.current.load());
    await act(() => result.current.open(LIST.versions[1]));
    expect(result.current.preview).toEqual({ entry: LIST.versions[1], doc: versionDoc(7) });
    expect(result.current.canStep).toEqual({ older: true, newer: true });
    await act(() => result.current.step('older'));
    expect(result.current.preview.entry.rev).toBe(2);
    expect(result.current.canStep).toEqual({ older: false, newer: true });
    await act(() => result.current.step('older')); // nothing older
    expect(result.current.preview.entry.rev).toBe(2);
    await act(() => result.current.step('newer'));
    expect(result.current.preview.entry.rev).toBe(7);
    act(() => result.current.close());
    expect(result.current.preview).toBeNull();
    expect(result.current.canStep).toEqual({ older: false, newer: false });
  });

  it('shows the version picked last, whichever answer lands first', async () => {
    const slow = deferred();
    api.fetchDocVersion.mockImplementationOnce(() => slow.promise);
    const { result } = setup();
    await act(() => result.current.load());
    let first;
    act(() => { first = result.current.open(LIST.versions[2]); });
    await act(() => result.current.open(LIST.versions[0]));
    await act(async () => { slow.resolve(versionDoc(2)); await first; });
    expect(result.current.preview.entry.rev).toBe(9);
  });

  it('drops a version still on its way once the person goes back to the doc', async () => {
    const slow = deferred();
    api.fetchDocVersion.mockImplementationOnce(() => slow.promise);
    const { result } = setup();
    let opening;
    act(() => { opening = result.current.open(LIST.versions[0]); });
    act(() => result.current.close());
    await act(async () => { slow.resolve(versionDoc(9)); await opening; });
    expect(result.current.preview).toBeNull();
  });

  it('says why a version could not be opened', async () => {
    api.fetchDocVersion.mockRejectedValueOnce(Object.assign(new Error('that version of the doc is not kept'), { status: 404 }));
    const { result, onError } = setup();
    await act(() => result.current.open(LIST.versions[0]));
    expect(onError).toHaveBeenCalledWith('that version of the doc is not kept');
    expect(result.current.preview).toBeNull();
    api.fetchDocVersion.mockRejectedValueOnce(new Error(''));
    await act(() => result.current.open(LIST.versions[0]));
    expect(onError).toHaveBeenLastCalledWith('Could not open that version');
  });
});

describe('restoring', () => {
  async function previewing(result) {
    await act(() => result.current.load());
    await act(() => result.current.open(LIST.versions[1]));
    act(() => result.current.askToRestore());
  }

  it('asks first, then brings the version back and offers to undo it', async () => {
    const { result } = setup();
    await previewing(result);
    expect(result.current.confirming).toBe(true);
    await act(() => result.current.restore());
    expect(api.restoreDocVersion).toHaveBeenCalledWith('p1', 'a1', 7);
    expect(result.current.preview).toBeNull();
    expect(result.current.confirming).toBe(false);
    expect(result.current.list).toBeNull(); // asked for afresh next time
    expect(result.current.restored).toEqual({ entry: LIST.versions[1], replacedRev: 12 });

    await act(() => result.current.undo());
    expect(api.restoreDocVersion).toHaveBeenLastCalledWith('p1', 'a1', 12);
    expect(result.current.restored).toBeNull();
  });

  it('can be called off', async () => {
    const { result } = setup();
    await previewing(result);
    act(() => result.current.cancelRestore());
    expect(result.current.confirming).toBe(false);
    expect(result.current.preview.entry.rev).toBe(7);
    expect(api.restoreDocVersion).not.toHaveBeenCalled();
  });

  it('is sent once, however often it is confirmed while on its way', async () => {
    const slow = deferred();
    api.restoreDocVersion.mockImplementationOnce(() => slow.promise);
    const { result } = setup();
    await previewing(result);
    let first;
    act(() => { first = result.current.restore(); });
    expect(result.current.restoring).toBe(true);
    await act(() => result.current.restore());
    await act(async () => { slow.resolve({ replacedRev: 12 }); await first; });
    expect(api.restoreDocVersion).toHaveBeenCalledTimes(1);
    expect(result.current.restoring).toBe(false);
  });

  it('does nothing with no version open', async () => {
    const { result } = setup();
    await act(() => result.current.restore());
    await act(() => result.current.undo());
    expect(api.restoreDocVersion).not.toHaveBeenCalled();
  });

  it('says why a restore or its undo failed, and keeps the version open', async () => {
    api.restoreDocVersion.mockRejectedValueOnce(new Error('this doc is being saved elsewhere; try again in a moment.'));
    const { result, onError } = setup();
    await previewing(result);
    await act(() => result.current.restore());
    expect(onError).toHaveBeenCalledWith('this doc is being saved elsewhere; try again in a moment.');
    expect(result.current.preview.entry.rev).toBe(7);
    expect(result.current.confirming).toBe(false);

    act(() => result.current.askToRestore());
    await act(() => result.current.restore());
    api.restoreDocVersion.mockRejectedValueOnce(new Error(''));
    await act(() => result.current.undo());
    expect(onError).toHaveBeenLastCalledWith('Could not undo the restore');
    api.restoreDocVersion.mockRejectedValueOnce(new Error(''));
    await act(() => result.current.open(LIST.versions[1]));
    act(() => result.current.askToRestore());
    await act(() => result.current.restore());
    expect(onError).toHaveBeenLastCalledWith('Could not restore that version');
  });

  it('offers Undo for a while, then lets it go', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = setup();
    await previewing(result);
    await act(() => result.current.restore());
    expect(result.current.restored).not.toBeNull();
    act(() => vi.advanceTimersByTime(RESTORED_SHOWN_MS));
    expect(result.current.restored).toBeNull();
  });

  it('lets go of Undo when it is dismissed', async () => {
    const { result } = setup();
    await previewing(result);
    await act(() => result.current.restore());
    act(() => result.current.dismissRestored());
    expect(result.current.restored).toBeNull();
  });
});

describe('another doc', () => {
  it('starts afresh, and what was asked for the previous doc is let go', async () => {
    const list = deferred();
    const restore = deferred();
    const { result, rerender, onError } = setup();
    await act(() => result.current.load());
    await act(() => result.current.open(LIST.versions[1]));
    act(() => result.current.askToRestore());
    api.fetchDocHistory.mockImplementationOnce(() => list.promise);
    api.restoreDocVersion.mockImplementationOnce(() => restore.promise);
    let loading;
    let restoring;
    act(() => { loading = result.current.load(); restoring = result.current.restore(); });

    rerender({ artifactId: 'a2' });
    expect(result.current.list).toBeNull();
    expect(result.current.preview).toBeNull();
    expect(result.current.confirming).toBe(false);
    await act(async () => {
      list.resolve(LIST);
      restore.reject(new Error('gone'));
      await loading;
      await restoring;
    });
    expect(result.current.list).toBeNull();
    expect(result.current.restored).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.restoring).toBe(false));
  });
});
