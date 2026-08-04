// Draft contract, exercised through the hook the composer actually uses:
// text survives unmount (navigation), stays isolated per surface, and clears
// on send. The store is asserted through the hook rather than directly because
// the unmount/remount pairing IS the bug (ENG-1221).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Fresh module registry per test so the store's in-memory copy is rebuilt
// from (and only from) that test's localStorage.
const load = async () => {
  vi.resetModules();
  return import('./useDraft');
};

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
    view.unmount();

    expect(mount(useDraft, 'new').result.current[0]).toBe('one two');
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

  it('ignores a corrupted or non-string persisted value', async () => {
    localStorage.setItem('anton.composerDrafts', '{"new":{"not":"text"},"task-a":"kept"}');
    const { useDraft } = await load();

    expect(mount(useDraft, 'new').result.current[0]).toBe('');
    expect(mount(useDraft, 'task-a').result.current[0]).toBe('kept');
  });
});
