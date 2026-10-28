import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { OrbitProvider, useOrbitSlot } from './orbitRegistry';

vi.mock('../components/ui', () => ({ OrbitMorph: () => <span data-testid="orb" /> }));

const observers = [];
class FakeResizeObserver {
  constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
  observe(el) { this.targets.push(el); }
  disconnect() {}
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

const rect = (top) => ({ top, left: 0, width: 22, height: 22, right: 22, bottom: top + 22 });

function Slot() {
  return <div data-testid="slot" ref={useOrbitSlot('header:streaming')} />;
}

function Chat() {
  const canvasRef = useRef(null);
  const scrollRef = useRef(null);
  return (
    <div ref={canvasRef} data-testid="canvas">
      <OrbitProvider canvasRef={canvasRef} scrollRef={scrollRef} state="thinking" activeSlot="header:streaming">
        <div ref={scrollRef}>
          <div data-testid="content"><Slot /></div>
        </div>
      </OrbitProvider>
    </div>
  );
}

describe('OrbitProvider', () => {
  // The first take grows above the thinking header: the header moves without
  // resizing, and the orb has to follow it rather than sit on the take's text.
  it('follows the slot when content above it pushes it down', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { getByTestId } = render(<Chat />);
    const slot = getByTestId('slot');
    const content = getByTestId('content');
    getByTestId('canvas').getBoundingClientRect = () => rect(0);
    slot.getBoundingClientRect = () => rect(10);

    const ro = observers.at(-1);
    expect(ro.targets).toContain(content);
    act(() => ro.cb());
    const orb = getByTestId('orb').parentElement;
    expect(orb.style.top).toBe('10px');

    slot.getBoundingClientRect = () => rect(80);
    act(() => ro.cb());
    expect(orb.style.top).toBe('80px');
  });
});
