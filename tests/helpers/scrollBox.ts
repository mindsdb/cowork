// A scroll container with layout the test controls. happy-dom does no
// layout, so scrollHeight and clientHeight read 0 and a transcript always
// looks pinned to its bottom. This fakes both for elements matching `isBox`,
// keeps whatever scrollTop is written, and routes scrollTo into scrollTop.
//
//   const box = fakeScrollBox((el) => el.dataset.scroll === 'true');
//   box.height = 2000; box.client = 600;
//   box.scrollReaderTo(el, 400);   // sets scrollTop and fires `scroll`
//   ...
//   box.restore();
export interface FakeScrollBox {
  height: number;
  client: number;
  scrollReaderTo(el: Element, top: number): void;
  restore(): void;
}

export function fakeScrollBox(isBox: (el: HTMLElement) => boolean): FakeScrollBox {
  const tops = new WeakMap<Element, number>();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const names = ['scrollHeight', 'clientHeight', 'scrollTop', 'scrollTo'] as const;
  const originals = Object.fromEntries(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]),
  ) as Record<(typeof names)[number], PropertyDescriptor | undefined>;
  const box: FakeScrollBox = {
    height: 0,
    client: 0,
    scrollReaderTo(el, top) {
      (el as HTMLElement).scrollTop = top;
      el.dispatchEvent(new Event('scroll'));
    },
    restore() {
      for (const name of names) {
        const original = originals[name];
        if (original) Object.defineProperty(HTMLElement.prototype, name, original);
        else delete proto[name];
      }
    },
  };
  const clamp = (top: number) => Math.max(0, Math.min(top, Math.max(0, box.height - box.client)));
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) { return isBox(this) ? box.height : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return isBox(this) ? box.client : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) { return tops.get(this) ?? 0; },
    set(this: HTMLElement, value: number) { tops.set(this, isBox(this) ? clamp(value) : value); },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, arg?: ScrollToOptions | number, y?: number) {
      const top = typeof arg === 'number' ? y : arg?.top;
      if (typeof top === 'number') this.scrollTop = top;
    },
  });
  return box;
}
