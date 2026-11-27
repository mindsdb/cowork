import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntersection } from './useIntersection';

let observers = [];
class FakeObserver {
  constructor(cb, options) { this.cb = cb; this.options = options; observers.push(this); }
  observe(el) { this.el = el; }
  disconnect() { this.disconnected = true; }
}

function Harness({ onChange, enabled = true, dep = 0, withRoot = false }) {
  const ref = useRef(null);
  const rootRef = useRef(null);
  useIntersection(ref, onChange, { rootRef: withRoot ? rootRef : null, rootMargin: '10px', enabled }, [dep]);
  return <div ref={rootRef}><span ref={ref} /></div>;
}

beforeEach(() => { observers = []; vi.stubGlobal('IntersectionObserver', FakeObserver); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('useIntersection', () => {
  it('reports whether the element is in view', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} withRoot />);
    expect(observers).toHaveLength(1);
    expect(observers[0].options.rootMargin).toBe('10px');
    expect(observers[0].options.root).toBeInstanceOf(HTMLDivElement);
    act(() => observers[0].cb([{ isIntersecting: true }]));
    act(() => observers[0].cb([{ isIntersecting: false }]));
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('observes nothing while disabled', () => {
    render(<Harness onChange={vi.fn()} enabled={false} />);
    expect(observers).toHaveLength(0);
  });

  it('observes again when a dep changes, and not for a new callback', () => {
    const { rerender } = render(<Harness onChange={vi.fn()} dep={1} />);
    rerender(<Harness onChange={vi.fn()} dep={1} />);
    expect(observers).toHaveLength(1);
    rerender(<Harness onChange={vi.fn()} dep={2} />);
    expect(observers).toHaveLength(2);
    expect(observers[0].disconnected).toBe(true);
  });
});
