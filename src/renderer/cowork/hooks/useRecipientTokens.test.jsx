// How typed and pasted addresses become recipients, apart from the field
// that shows them: RecipientField.test.jsx drives the same rules through the
// input.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecipientTokens } from './useRecipientTokens';

const ANA = { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' };
const BO = { id: 'u-bo', name: 'Bo Chen', email: 'bo@acme.com' };

const directoryOf = (over = {}) => ({
  status: 'ready',
  people: [ANA],
  truncated: false,
  loadedAt: Date.now(),
  refreshing: false,
  lookingUp: false,
  failure: null,
  lookupFailure: null,
  addresses: {},
  malformed: {},
  refresh: vi.fn(),
  lookUp: vi.fn(),
  ...over,
});

function setup({ directory = directoryOf(), allowExternal = true, emailsOnly = false } = {}) {
  const latest = { current: { teamIds: [], userIds: [], emails: [] } };
  const emit = vi.fn((patch) => { latest.current = { ...latest.current, ...patch }; });
  const showText = vi.fn();
  const remember = vi.fn();
  const view = renderHook((props) => useRecipientTokens({
    emailsOnly,
    allowExternal,
    ownEmail: 'mia@acme.com',
    org: 'Acme',
    latest,
    emit,
    remember,
    showText,
    reopen: vi.fn(),
    ...props,
  }), { initialProps: { directory } });
  return { ...view, emit, showText, remember, latest };
}

describe('useRecipientTokens', () => {
  it('adds a member as that person and an outside address as an email', () => {
    const { result, emit, remember } = setup();

    act(() => { result.current.resolve(['Ana@acme.com', 'zed@partner.io']); });

    expect(emit).toHaveBeenCalledWith({ userIds: ['u-ana'], emails: ['zed@partner.io'] });
    expect(remember).toHaveBeenCalledWith([ANA]);
    expect(result.current.notAdded).toEqual([]);
  });

  it('reports why an address was not added', () => {
    const { result, emit } = setup({ allowExternal: false, directory: directoryOf({ malformed: { 'odd@acme.com': true } }) });

    act(() => { result.current.resolve(['zed@partner.io', 'mia@acme.com', 'nope', 'odd@acme.com']); });

    expect(emit).not.toHaveBeenCalled();
    expect(result.current.notAdded).toEqual([
      { raw: 'zed@partner.io', reason: 'not in Acme' },
      { raw: 'mia@acme.com', reason: "that's you" },
      { raw: 'nope', reason: 'not an email' },
      { raw: 'odd@acme.com', reason: 'not an email' },
    ]);
  });

  it('holds addresses while the directory loads, and adds them once it answers', () => {
    const { result, rerender, emit, showText } = setup({ directory: directoryOf({ status: 'loading', people: [] }) });

    act(() => { result.current.resolve(['ana@acme.com']); });
    expect(result.current.held).toEqual({ tokens: ['ana@acme.com'], refreshed: false, lookedUp: false });
    expect(showText).toHaveBeenLastCalledWith('ana@acme.com');
    expect(emit).not.toHaveBeenCalled();

    rerender({ directory: directoryOf() });

    expect(emit).toHaveBeenCalledWith({ userIds: ['u-ana'], emails: [] });
    expect(result.current.held).toBeNull();
  });

  it('asks MindsHub about an address past a truncated list, and says nothing about it until it answers', () => {
    const directory = directoryOf({ truncated: true });
    const { result, rerender, emit } = setup({ directory });
    expect(result.current.isAnswered('bo@acme.com', null)).toBe(false);

    act(() => {
      result.current.resolve(['bo@acme.com']);
      // As useOrgDirectory does: the lookup starts at once.
      rerender({ directory: directoryOf({ truncated: true, lookingUp: true }) });
    });
    expect(directory.lookUp).toHaveBeenCalledWith(['bo@acme.com']);
    expect(emit).not.toHaveBeenCalled();
    expect(result.current.notAdded).toEqual([]);

    rerender({ directory: directoryOf({ truncated: true, addresses: { 'bo@acme.com': BO } }) });

    expect(emit).toHaveBeenCalledWith({ userIds: ['u-bo'], emails: [] });
    expect(result.current.isAnswered('bo@acme.com', BO)).toBe(true);
  });

  it('reads a directory over a minute old again before calling an address outside the org', () => {
    const old = { loadedAt: Date.now() - 61 * 1000 };
    const directory = directoryOf(old);
    const { result, rerender, emit } = setup({ directory });
    expect(result.current.directoryStale).toBe(true);
    expect(result.current.isAnswered('bo@acme.com', null)).toBe(false);

    act(() => {
      result.current.resolve(['bo@acme.com']);
      // As useOrgDirectory does: the read starts at once.
      rerender({ directory: directoryOf({ ...old, refreshing: true }) });
    });

    expect(directory.refresh).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
    expect(result.current.held).toEqual({ tokens: ['bo@acme.com'], refreshed: true, lookedUp: false });

    rerender({ directory: directoryOf({ people: [ANA, BO] }) });
    expect(emit).toHaveBeenCalledWith({ userIds: ['u-bo'], emails: [] });
  });

  /* The new read of an old directory got no answer: the address stays in the
     input, and the reason is why that read failed (`failure`), not why an
     earlier lookup did (`lookupFailure`). */
  it.each([
    ['refused', 'mindshub_refused', 'mindshub_throttled', 'MindsHub refused to check who is in Acme'],
    ['throttled', 'mindshub_throttled', 'mindshub_refused', 'MindsHub is limiting requests, try again in a minute'],
    ['unreachable', 'mindshub_unreachable', 'mindshub_refused', "couldn't check who is in Acme, try again"],
  ])('keeps an address in the input, and says why, when the new read gets no answer: %s', (_, failure, lookupFailure, reason) => {
    const old = { loadedAt: Date.now() - 61 * 1000, lookupFailure };
    const { result, rerender, emit, showText } = setup({ directory: directoryOf(old) });

    act(() => {
      result.current.resolve(['bo@acme.com']);
      // As useOrgDirectory does: the read starts at once.
      rerender({ directory: directoryOf({ ...old, refreshing: true }) });
    });
    // The read failed: the list is as old as it was.
    rerender({ directory: directoryOf({ ...old, failure }) });

    expect(emit).not.toHaveBeenCalled();
    expect(showText).toHaveBeenLastCalledWith('bo@acme.com');
    expect(result.current.notAdded).toEqual([{ raw: 'bo@acme.com', reason }]);
  });
});
