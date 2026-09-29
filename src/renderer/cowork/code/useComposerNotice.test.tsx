import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { messageNotice, type ComposerNotice } from './composerNotices';
import { useComposerNotice } from './useComposerNotice';


const queue: ComposerNotice = { key: 'queue', tone: 'neutral', icon: 'clock', title: '', queue: true };
const paused: ComposerNotice = { key: 'recovery:paused', tone: 'warning', icon: 'refresh', title: 'Task paused', reopen: true };


function renderNotices(initial: Array<ComposerNotice | null>, scope = 'task-1') {
  return renderHook(({ candidates, taskId }) => useComposerNotice(candidates, taskId), {
    initialProps: { candidates: initial, taskId: scope },
  });
}


describe('useComposerNotice', () => {
  it('shows the most blocking notice and counts the rest behind it, the queue included', () => {
    const { result } = renderNotices([paused, messageNotice('workspace', 'Uncommitted changes.'), queue]);

    expect(result.current.notice?.key).toBe('recovery:paused');
    expect(result.current.more).toBe(2);
  });

  it('steps through the waiting notices and back to the first', () => {
    const { result } = renderNotices([messageNotice('workspace', 'Uncommitted changes.'), queue]);

    act(() => result.current.showNext());
    expect(result.current.notice?.key).toBe('queue');
    expect(result.current.more).toBe(1);
    act(() => result.current.showNext());
    expect(result.current.notice?.key).toBe('workspace:Uncommitted changes.');
  });

  it('shows a dismissed error again when a retry fails with the same message', () => {
    const failed = messageNotice('error', 'Could not send your message.');
    const { result, rerender } = renderNotices([failed, queue]);
    act(() => result.current.dismiss(failed!.key));
    expect(result.current.notice?.key).toBe('queue');

    // The retry clears the error while it runs, then the same failure returns.
    rerender({ candidates: [null, queue], taskId: 'task-1' });
    rerender({ candidates: [failed, queue], taskId: 'task-1' });
    expect(result.current.notice?.key).toBe(failed!.key);
  });

  it('keeps a dismissal while the same notice stays present', () => {
    const warning = messageNotice('workspace', 'Uncommitted changes.');
    const { result, rerender } = renderNotices([warning]);
    act(() => result.current.dismiss(warning!.key));
    rerender({ candidates: [messageNotice('workspace', 'Uncommitted changes.')], taskId: 'task-1' });

    expect(result.current.notice).toBeNull();
  });

  it('returns to the top notice when a new one arrives, and resets on another task', () => {
    const warning = messageNotice('workspace', 'Uncommitted changes.');
    const { result, rerender } = renderNotices([warning, queue]);
    act(() => result.current.showNext());
    rerender({ candidates: [paused, warning, queue], taskId: 'task-1' });
    expect(result.current.notice?.key).toBe('recovery:paused');

    act(() => result.current.dismiss('recovery:paused'));
    rerender({ candidates: [paused, warning, queue], taskId: 'task-2' });
    expect(result.current.notice?.key).toBe('recovery:paused');
  });
});
