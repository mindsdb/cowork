import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewportZoomLock } from './useViewportZoomLock';

const ORIGINAL = 'width=device-width, initial-scale=1';
const LOCKED = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

let meta;

beforeEach(() => {
  meta = document.createElement('meta');
  meta.setAttribute('name', 'viewport');
  meta.setAttribute('content', ORIGINAL);
  document.head.appendChild(meta);
});

afterEach(() => {
  meta.remove();
  vi.useRealTimers();
});

const focus = (el) => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
const blur = (el) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

describe('useViewportZoomLock', () => {
  it('does nothing when not on mobile', () => {
    renderHook(() => useViewportZoomLock(false));
    const input = document.createElement('input');
    document.body.appendChild(input);
    focus(input);
    expect(meta.getAttribute('content')).toBe(ORIGINAL);
    input.remove();
  });

  it('locks the viewport on text-input focus and restores it on blur', () => {
    vi.useFakeTimers();
    renderHook(() => useViewportZoomLock(true));
    const input = document.createElement('input');
    document.body.appendChild(input);

    focus(input);
    expect(meta.getAttribute('content')).toBe(LOCKED);

    blur(input);
    // restore is deferred one tick
    expect(meta.getAttribute('content')).toBe(LOCKED);
    vi.runAllTimers();
    expect(meta.getAttribute('content')).toBe(ORIGINAL);
    input.remove();
  });

  it('ignores non-text inputs (checkbox, button, file)', () => {
    renderHook(() => useViewportZoomLock(true));
    for (const type of ['checkbox', 'button', 'file']) {
      const el = document.createElement('input');
      el.type = type;
      document.body.appendChild(el);
      focus(el);
      expect(meta.getAttribute('content')).toBe(ORIGINAL);
      el.remove();
    }
  });

  it('treats contenteditable surfaces as text inputs', () => {
    renderHook(() => useViewportZoomLock(true));
    const div = document.createElement('div');
    // happy-dom reads isContentEditable off the attribute
    Object.defineProperty(div, 'isContentEditable', { value: true });
    document.body.appendChild(div);
    focus(div);
    expect(meta.getAttribute('content')).toBe(LOCKED);
    div.remove();
  });

  it('restores the original content and detaches listeners on unmount', () => {
    const { unmount } = renderHook(() => useViewportZoomLock(true));
    const input = document.createElement('input');
    document.body.appendChild(input);
    focus(input);
    expect(meta.getAttribute('content')).toBe(LOCKED);

    unmount();
    expect(meta.getAttribute('content')).toBe(ORIGINAL);

    // listeners gone — a later focus is a no-op
    focus(input);
    expect(meta.getAttribute('content')).toBe(ORIGINAL);
    input.remove();
  });
});
