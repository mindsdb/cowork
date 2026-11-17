import { describe, expect, it, vi } from 'vitest';
import { createSeenCallBack } from './seenCallBack';

function tab(visibilityState = 'visible') {
  const doc = {
    visibilityState,
    listeners: new Set(),
    addEventListener: (_, fn) => doc.listeners.add(fn),
    removeEventListener: (_, fn) => doc.listeners.delete(fn),
    show: () => {
      doc.visibilityState = 'visible';
      [...doc.listeners].forEach((fn) => fn());
    },
  };
  return doc;
}

const make = (doc, overrides = {}) => {
  const deps = {
    announce: vi.fn(() => false), canCallBack: vi.fn(() => true), take: vi.fn(), callBack: vi.fn(), doc, ...overrides,
  };
  return { deps, seen: createSeenCallBack(deps) };
};

describe('a call back for finished work', () => {
  it('calls back at once in a tab in sight', () => {
    const { deps, seen } = make(tab());
    expect(seen.join('later')).toBe(false);
    seen.callBack('Flights from $212.');
    expect(deps.take).toHaveBeenCalledOnce();
    expect(deps.callBack).toHaveBeenCalledWith('Flights from $212.', { asks: false });
  });

  it('waits for a tab out of sight, and says a second result that finished meanwhile too', () => {
    const doc = tab('hidden');
    const { deps, seen } = make(doc);
    seen.callBack('Anton finished "flights": from $212.');
    expect(deps.callBack).not.toHaveBeenCalled();
    // The second result finds the first one's call back waiting, and joins it.
    expect(seen.join('Anton finished "hotels": from $140.')).toBe(true);
    doc.show();
    expect(deps.callBack).toHaveBeenCalledTimes(1);
    expect(deps.callBack).toHaveBeenCalledWith('Anton finished "flights": from $212.\nAnton finished "hotels": from $140.', { asks: false });
    // Done waiting: the next result calls back on its own.
    expect(seen.join('third')).toBe(false);
  });

  it('says it on a call started meanwhile, or not at all once call backs are off', () => {
    const doc = tab('hidden');
    const { deps, seen } = make(doc, { announce: vi.fn(() => true) });
    seen.callBack('one');
    seen.join('two');
    doc.show();
    expect(deps.announce).toHaveBeenCalledWith('one\ntwo', { asks: false });
    expect(deps.callBack).not.toHaveBeenCalled();

    const later = tab('hidden');
    const off = make(later, { canCallBack: vi.fn(() => false) });
    off.seen.callBack('three');
    later.show();
    expect(off.deps.callBack).not.toHaveBeenCalled();
  });

  /* A request Anton stopped on joins a result's call back, said as what he
     needs; one answered on screen while the tab waited is left out. */
  it('asks when any news asks, and leaves out news no longer due', () => {
    const doc = tab('hidden');
    const { deps, seen } = make(doc);
    let open = true;
    seen.callBack('Anton finished "hotels": from $140.');
    seen.join('Anton needs a sign-in.', { asks: true, due: () => open });
    seen.join('Anton needs a seat.', { asks: true, due: () => false });
    doc.show();
    expect(deps.callBack).toHaveBeenCalledWith('Anton finished "hotels": from $140.\nAnton needs a sign-in.', { asks: true });

    const again = tab('hidden');
    const other = make(again);
    open = false;
    other.seen.callBack('Anton needs a sign-in.', { asks: true, due: () => open });
    again.show();
    // Nothing is said, and the call back the hung-up call left stays armed.
    expect(other.deps.callBack).not.toHaveBeenCalled();
    expect(other.deps.announce).not.toHaveBeenCalled();
    expect(other.deps.take).not.toHaveBeenCalled();
  });
});
