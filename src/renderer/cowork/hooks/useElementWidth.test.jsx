import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { useElementWidth } from './useElementWidth';

function Probe({ onWidth }) {
  const ref = useRef(null);
  onWidth(useElementWidth(ref));
  return <div ref={ref} style={{ paddingLeft: '28px', paddingRight: '28px' }} />;
}

describe('useElementWidth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('knows the content width when it mounts, without waiting for an observer report', () => {
    // An observer that never reports: the width has to come from measuring.
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    const widths = [];
    render(<Probe onWidth={(w) => widths.push(w)} />);
    expect(widths.at(-1)).toBe(334);
  });

  it('follows the observer as the element resizes', () => {
    let report;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) { report = cb; }
      observe() {}
      disconnect() {}
    });
    const widths = [];
    render(<Probe onWidth={(w) => widths.push(w)} />);
    act(() => report([{ contentRect: { width: 900 } }]));
    expect(widths.at(-1)).toBe(900);
  });

  it('stays 0 where there is no layout to measure', () => {
    const widths = [];
    render(<Probe onWidth={(w) => widths.push(w)} />);
    expect(widths.at(-1)).toBe(0);
  });
});
