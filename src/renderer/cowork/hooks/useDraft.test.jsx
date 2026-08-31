// Draft contract, exercised through the hook the composer actually uses:
// text survives unmount (navigation), stays isolated per surface, and clears
// on send. The store is asserted through the hook rather than directly because
// the unmount/remount pairing IS the bug (ENG-1221).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Fresh module registry per test so the store's in-memory copy is rebuilt
// from (and only from) that test's localStorage.
const base64UrlJson = (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const accessToken = (subject, organizationId) => (
  `${base64UrlJson({ alg: 'none' })}.${base64UrlJson({
    sub: subject,
    activate_organization: { id: organizationId },
  })}.signature`
);

const load = async (identity = null) => {
  vi.resetModules();
  if (identity) {
    const cacheIdentity = await import('../lib/organizationCacheIdentity');
    cacheIdentity.requireWebOrganizationCacheIdentity();
    expect(cacheIdentity.pinWebOrganizationCacheIdentity(
      accessToken(identity.subject, identity.organizationId),
    )).toBe('pinned');
  }
  return import('./useDraft');
};

const epochDraftKey = (id) => `anton.composerDrafts:organization:${id}`;

const mount = (useDraft, key) => renderHook(({ k }) => useDraft(k), { initialProps: { k: key } });

describe('useDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Each test gets a fresh module instance, so the previous one's debounce
  // timer is still pending and would write its drafts back after the clear
  // above. `pagehide` flushes and cancels it.
  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
  });

  it('restores text after the composer unmounts and remounts', async () => {
    const { useDraft } = await load();

    const first = mount(useDraft, 'new');
    act(() => first.result.current[1]('half-written thought'));
    first.unmount();

    const second = mount(useDraft, 'new');
    expect(second.result.current[0]).toBe('half-written thought');
  });

  it('keeps surfaces isolated and swaps text when the key changes in place', async () => {
    const { useDraft } = await load();

    const home = mount(useDraft, 'new');
    act(() => home.result.current[1]('for the new task'));
    home.unmount();

    // One Composer instance reused across conversations (ChatView has no key).
    const chat = mount(useDraft, 'task-a');
    expect(chat.result.current[0]).toBe('');
    act(() => chat.result.current[1]('reply to A'));

    chat.rerender({ k: 'task-b' });
    expect(chat.result.current[0]).toBe('');

    chat.rerender({ k: 'task-a' });
    expect(chat.result.current[0]).toBe('reply to A');

    chat.rerender({ k: 'new' });
    expect(chat.result.current[0]).toBe('for the new task');
  });

  it('drops the draft when the composer clears itself on send', async () => {
    const { useDraft } = await load();

    const view = mount(useDraft, 'new');
    act(() => view.result.current[1]('sent text'));
    window.dispatchEvent(new Event('pagehide')); // draft is now on disk
    expect(localStorage.getItem('anton.composerDrafts')).toContain('sent text');

    act(() => view.result.current[1]('')); // what handleSend does
    view.unmount();

    expect(mount(useDraft, 'new').result.current[0]).toBe('');
    // Cleared synchronously, not on the debounce: quitting right after a send
    // must not bring the sent text back as a draft.
    expect(localStorage.getItem('anton.composerDrafts')).not.toContain('sent text');
  });

  it('accepts an updater function like useState', async () => {
    const { useDraft } = await load();

    const view = mount(useDraft, 'new');
    act(() => view.result.current[1]('one'));
    act(() => view.result.current[1]((prev) => `${prev} two`));
    // Two updaters batched into one render must compose, not clobber.
    act(() => {
      view.result.current[1]((prev) => `${prev} three`);
      view.result.current[1]((prev) => `${prev} four`);
    });
    view.unmount();

    expect(mount(useDraft, 'new').result.current[0]).toBe('one two three four');
  });

  it('survives a reload via localStorage', async () => {
    const { useDraft } = await load();
    const view = mount(useDraft, 'task-a');
    act(() => view.result.current[1]('typed before quitting'));
    view.unmount();
    window.dispatchEvent(new Event('pagehide')); // flush the debounced write

    // Reload = new module instance reading the persisted keys.
    const reloaded = await load();
    expect(mount(reloaded.useDraft, 'task-a').result.current[0]).toBe('typed before quitting');
  });

  // A new task starts on a `tmp-` id and adopts the server's canonical id on
  // the first turn's `response.created`, so the key changes under a composer
  // the user may already be typing in.
  it('carries a draft across an id change', async () => {
    const { useDraft } = await load();
    const { moveDraft } = await import('../lib/draftStore');

    const view = mount(useDraft, 'tmp-1735');
    act(() => view.result.current[1]('follow-up typed while the first turn runs'));

    act(() => moveDraft('tmp-1735', 'real-uuid'));
    view.rerender({ k: 'real-uuid' });

    expect(view.result.current[0]).toBe('follow-up typed while the first turn runs');
    expect(mount(useDraft, 'tmp-1735').result.current[0]).toBe('');
  });

  // Every test file that renders a composer needs the module-level store
  // emptied between tests (ENG-1407). The helper has to leave nothing behind:
  // a write still armed on the 400 ms debounce would land after the clear and
  // put the key back on disk.
  it('reset empties the store and cancels the pending write', async () => {
    vi.useFakeTimers();
    try {
      const { useDraft } = await load();
      const { __resetDraftsForTests } = await import('../lib/draftStore');

      const view = mount(useDraft, 'task-a');
      act(() => view.result.current[1]('typed just before the reset'));

      __resetDraftsForTests();
      vi.advanceTimersByTime(1000); // past the debounce the keystroke armed

      expect(localStorage.getItem('anton.composerDrafts')).toBeNull();
      expect(mount(useDraft, 'task-a').result.current[0]).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears previous-organization drafts from memory and disk', async () => {
    const { useDraft } = await load();
    const { clearDraftsForOrganizationSwitch } = await import('../lib/draftStore');
    const view = mount(useDraft, 'task-a');
    act(() => view.result.current[1]('old organization draft'));
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem('anton.composerDrafts')).toContain('old organization draft');

    clearDraftsForOrganizationSwitch();

    expect(localStorage.getItem('anton.composerDrafts')).toBeNull();
    expect(mount(useDraft, 'task-a').result.current[0]).toBe('');
  });

  it('still clears drafts from memory when removing persisted drafts fails', async () => {
    const { useDraft } = await load();
    const { clearDraftsForOrganizationSwitch } = await import('../lib/draftStore');
    const view = mount(useDraft, 'task-a');
    act(() => view.result.current[1]('draft in unavailable storage'));

    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    try {
      expect(() => clearDraftsForOrganizationSwitch()).not.toThrow();
      expect(mount(useDraft, 'task-a').result.current[0]).toBe('');
    } finally {
      removeItem.mockRestore();
    }
  });

  it('cancels an armed write so pagehide cannot restore previous-organization text', async () => {
    vi.useFakeTimers();
    try {
      const { useDraft } = await load();
      const { clearDraftsForOrganizationSwitch } = await import('../lib/draftStore');
      const view = mount(useDraft, 'task-a');
      act(() => view.result.current[1]('typed just before switching'));

      clearDraftsForOrganizationSwitch();
      window.dispatchEvent(new Event('pagehide'));
      vi.advanceTimersByTime(1000);

      expect(localStorage.getItem('anton.composerDrafts')).toBeNull();
      expect(mount(useDraft, 'task-a').result.current[0]).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a corrupted or non-string persisted value', async () => {
    localStorage.setItem('anton.composerDrafts', '{"new":{"not":"text"},"task-a":"kept"}');
    const { useDraft } = await load();

    expect(mount(useDraft, 'new').result.current[0]).toBe('');
    expect(mount(useDraft, 'task-a').result.current[0]).toBe('kept');
  });

  it('does not hydrate an unscoped draft after an organization transition', async () => {
    localStorage.setItem('anton.composerDrafts', JSON.stringify({
      new: 'previous organization draft',
    }));
    localStorage.setItem('anton.organizationTransition', JSON.stringify({
      version: 1,
      id: 'current-organization',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now(),
    }));

    const { useDraft } = await load();

    expect(mount(useDraft, 'new').result.current[0]).toBe('');
  });

  it('does not persist a late draft write from a previous organization epoch', async () => {
    const { useDraft } = await load();
    const oldView = mount(useDraft, 'new');
    act(() => oldView.result.current[1]('organization A draft'));
    window.dispatchEvent(new Event('pagehide'));

    localStorage.setItem('anton.organizationTransition', JSON.stringify({
      version: 1,
      id: 'organization-b',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now(),
    }));
    act(() => oldView.result.current[1]('late organization A draft'));
    window.dispatchEvent(new Event('pagehide'));

    expect(localStorage.getItem('anton.composerDrafts')).not.toContain('late organization A draft');
    const current = await load();
    expect(mount(current.useDraft, 'new').result.current[0]).toBe('');
  });

  it('does not let a waking old document delete current-epoch drafts', async () => {
    localStorage.setItem('anton.organizationTransition', JSON.stringify({
      version: 1,
      id: 'organization-a',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now(),
    }));
    const old = await load();
    const oldStore = await import('../lib/draftStore');
    const oldView = mount(old.useDraft, 'new');
    act(() => oldView.result.current[1]('organization A draft'));
    window.dispatchEvent(new Event('pagehide'));

    localStorage.setItem('anton.organizationTransition', JSON.stringify({
      version: 1,
      id: 'organization-b',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now(),
    }));
    const current = await load();
    const currentView = mount(current.useDraft, 'new');
    act(() => currentView.result.current[1]('organization B draft'));
    window.dispatchEvent(new Event('pagehide'));

    oldStore.clearDraftsForOrganizationSwitch();

    expect(localStorage.getItem(epochDraftKey('organization-b')))
      .toContain('organization B draft');
    const reloaded = await load();
    expect(mount(reloaded.useDraft, 'new').result.current[0]).toBe('organization B draft');
  });

  it('does not hydrate an old-org draft after closing and switching in another app', async () => {
    const organizationA = await load({ subject: 'user-1', organizationId: 'organization-a' });
    const firstSession = mount(organizationA.useDraft, 'new');
    act(() => firstSession.result.current[1]('organization A draft'));
    window.dispatchEvent(new Event('pagehide'));
    firstSession.unmount();

    const organizationB = await load({ subject: 'user-1', organizationId: 'organization-b' });
    expect(mount(organizationB.useDraft, 'new').result.current[0]).toBe('');

    const returnedToA = await load({ subject: 'user-1', organizationId: 'organization-a' });
    expect(mount(returnedToA.useDraft, 'new').result.current[0])
      .toBe('organization A draft');
  });
});
