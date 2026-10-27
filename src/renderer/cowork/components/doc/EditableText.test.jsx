// EditableText: what it commits, and when it says an edit is still waiting.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EditableText, { COMMIT_MS } from './EditableText';
import { PendingEdits } from './useSaveIndicator';

afterEach(() => { vi.useRealTimers(); });

function typeInto(el, text) {
  el.focus();
  el.textContent = text;
  fireEvent.input(el);
}

describe('EditableText', () => {
  it('commits what was typed once the typing pauses', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<EditableText value="Plan" plain ariaLabel="Name" onCommit={onCommit} />);
    typeInto(screen.getByRole('textbox', { name: 'Name' }), 'Plan B');
    act(() => { vi.advanceTimersByTime(COMMIT_MS - 1); });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onCommit).toHaveBeenCalledWith('Plan B');
  });

  it('says an edit is waiting from the first keystroke until it is committed', () => {
    vi.useFakeTimers();
    const onPendingChange = vi.fn();
    render(
      <PendingEdits.Provider value={onPendingChange}>
        <EditableText value="Plan" plain ariaLabel="Name" onCommit={() => {}} />
      </PendingEdits.Provider>,
    );
    const el = screen.getByRole('textbox', { name: 'Name' });
    typeInto(el, 'Plan B');
    typeInto(el, 'Plan BC');
    expect(onPendingChange.mock.calls.map((c) => c[1])).toEqual([true]);
    act(() => { vi.advanceTimersByTime(COMMIT_MS); });
    expect(onPendingChange.mock.calls.map((c) => c[1])).toEqual([true, false]);
    expect(onPendingChange.mock.calls[0][0]).toBe(onPendingChange.mock.calls[1][0]);
  });

  it('commits text typed just before it goes away', () => {
    // Found in review: unmounting cancelled the waiting commit, so closing a
    // doc from the keyboard (no blur) right after typing lost the words.
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const onPendingChange = vi.fn();
    const { unmount } = render(
      <PendingEdits.Provider value={onPendingChange}>
        <EditableText value="Plan" plain ariaLabel="Name" onCommit={onCommit} />
      </PendingEdits.Provider>,
    );
    typeInto(screen.getByRole('textbox', { name: 'Name' }), 'Plan B');
    unmount();
    expect(onCommit).toHaveBeenCalledWith('Plan B');
    expect(onPendingChange).toHaveBeenLastCalledWith(expect.any(String), false);
    act(() => { vi.advanceTimersByTime(COMMIT_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('forgets what it holds when told its text went elsewhere', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const ref = { current: null };
    const { unmount } = render(<EditableText ref={ref} value="Two" ariaLabel="Name" onCommit={onCommit} />);
    typeInto(screen.getByRole('textbox', { name: 'Name' }), 'Two more');
    act(() => { ref.current.discard(); });
    unmount();
    act(() => { vi.advanceTimersByTime(COMMIT_MS); });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('puts the last good value back when a commit is refused, once the person leaves', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn((v) => (v.trim() ? undefined : false));
    render(<EditableText value="Plan" plain ariaLabel="Name" onCommit={onCommit} />);
    const el = screen.getByRole('textbox', { name: 'Name' });
    typeInto(el, '');
    act(() => { vi.advanceTimersByTime(COMMIT_MS); });
    expect(onCommit).toHaveBeenCalledWith('');
    expect(el.textContent).toBe(''); // still theirs while they are in it
    fireEvent.blur(el);
    expect(el.textContent).toBe('Plan');
  });

  it('keeps one handle while its parent re-renders', () => {
    const ref = vi.fn();
    const { rerender } = render(<EditableText ref={ref} value="Plan" ariaLabel="Name" onCommit={() => {}} />);
    rerender(<EditableText ref={ref} value="Plan" ariaLabel="Name" onCommit={() => {}} />);
    expect(ref).toHaveBeenCalledTimes(1);
    expect(ref.mock.calls[0][0]).toMatchObject({ flush: expect.any(Function), set: expect.any(Function) });
  });

  it('commits through the latest onCommit it was given', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<EditableText value="Plan" plain ariaLabel="Name" onCommit={first} />);
    rerender(<EditableText value="Plan" plain ariaLabel="Name" onCommit={second} />);
    typeInto(screen.getByRole('textbox', { name: 'Name' }), 'Plan B');
    act(() => { vi.advanceTimersByTime(COMMIT_MS); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('Plan B');
  });

  it('escapes plain text it shows', () => {
    render(<EditableText value={'<b>"x" & y</b>'} plain ariaLabel="Name" />);
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('<b>"x" & y</b>');
  });

  it('reads a non-breaking space typed into plain text as a space', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<EditableText value="" plain ariaLabel="Name" onCommit={onCommit} />);
    typeInto(screen.getByRole('textbox', { name: 'Name' }), 'a\u00a0b');
    act(() => { vi.advanceTimersByTime(COMMIT_MS); });
    expect(onCommit).toHaveBeenCalledWith('a b');
  });
});

