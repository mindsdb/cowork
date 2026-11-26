// Divider between adjacent options — hidden on whichever side touches the
// current selection, so it never cuts across a selected item's own
// background fill/shadow.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleGroup } from './ToggleGroup';

const OPTIONS = [
  { value: 'anton', label: 'Anton' },
  { value: 'other', label: 'Other' },
  { value: 'claude-code', label: 'Claude-Code' },
];

// Dividers are the aria-hidden spans rendered between BaseToggle items —
// query them by role exclusion instead of a test id, since they carry no
// semantic role of their own.
const dividers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[aria-hidden="true"]:not([data-toggle-pill])'));

describe('ToggleGroup — divider between options', () => {
  it('renders one fewer divider than there are options', () => {
    const { container } = render(
      <ToggleGroup value="anton" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
    );
    expect(dividers(container)).toHaveLength(OPTIONS.length - 1);
  });

  it('hides the divider on both sides of the selected option, shows the rest', () => {
    const { container } = render(
      <ToggleGroup value="other" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
    );
    const [antonOther, otherClaudeCode] = dividers(container);
    // other is selected — both its neighboring dividers (anton|other and
    // other|claude-code) touch it, so both are hidden.
    expect(antonOther).toHaveStyle({ opacity: '0' });
    expect(otherClaudeCode).toHaveStyle({ opacity: '0' });
  });

  it('shows a divider whose neither side is selected', () => {
    const { container } = render(
      <ToggleGroup value="claude-code" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
    );
    const [antonOther, otherClaudeCode] = dividers(container);
    // claude-code is selected — anton|other touches neither side of it.
    expect(antonOther).toHaveStyle({ opacity: '1' });
    expect(otherClaudeCode).toHaveStyle({ opacity: '0' });
  });

  it('moves the hidden divider as selection changes', async () => {
    const user = userEvent.setup();
    let value = 'anton';
    const onValueChange = vi.fn((v) => { value = v; });
    const { container, rerender } = render(
      <ToggleGroup value={value} onValueChange={onValueChange} options={OPTIONS} aria-label="Choose harness" />,
    );

    await user.click(screen.getByRole('button', { name: 'Claude-Code' }));
    rerender(
      <ToggleGroup value={value} onValueChange={onValueChange} options={OPTIONS} aria-label="Choose harness" />,
    );

    const [antonOther, otherClaudeCode] = dividers(container);
    expect(antonOther).toHaveStyle({ opacity: '1' });
    expect(otherClaudeCode).toHaveStyle({ opacity: '0' });
  });
});

describe('ToggleGroup — disabled', () => {
  it('blocks selection changes while disabled', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ToggleGroup value="anton" onValueChange={onValueChange} options={OPTIONS} disabled aria-label="Choose harness" />);

    await user.click(screen.getByRole('button', { name: 'Other' }));

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Other' })).toBeDisabled();
  });
});

// A ResizeObserver that only notifies observers of the element that resized,
// as the browser does.
function installResizeObserver() {
  const watchers = new Map<Element, Set<() => void>>();
  class FakeResizeObserver {
    private cb: () => void;
    private targets = new Set<Element>();
    constructor(cb: () => void) { this.cb = cb; }
    observe(el: Element) {
      this.targets.add(el);
      if (!watchers.has(el)) watchers.set(el, new Set());
      watchers.get(el)!.add(this.cb);
    }
    disconnect() {
      this.targets.forEach((el) => watchers.get(el)?.delete(this.cb));
      this.targets.clear();
    }
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return (el: Element) => watchers.get(el)?.forEach((cb) => cb());
}

function setBox(el: HTMLElement, left: number, width: number) {
  Object.defineProperty(el, 'offsetLeft', { configurable: true, value: left });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
}

describe('ToggleGroup — selection pill', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // Content-sized options change width without the track changing, e.g. when
  // the language changes while the app is open.
  it('follows the selected option when only that option changes width', () => {
    const resize = installResizeObserver();
    const proto = HTMLElement.prototype;
    const left = Object.getOwnPropertyDescriptor(proto, 'offsetLeft');
    const width = Object.getOwnPropertyDescriptor(proto, 'offsetWidth');
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return 85; } });
    Object.defineProperty(proto, 'offsetLeft', { configurable: true, get() { return 2; } });
    try {
      const { container } = render(
        <ToggleGroup value="anton" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
      );
      const pill = () => container.querySelector('[data-toggle-pill]') as HTMLElement;
      expect(pill().style.width).toBe('85px');

      const selected = screen.getByRole('button', { name: 'Anton' });
      setBox(selected, 2, 74);
      act(() => resize(selected));

      expect(pill().style.width).toBe('74px');
    } finally {
      if (left) Object.defineProperty(proto, 'offsetLeft', left); else delete (proto as any).offsetLeft;
      if (width) Object.defineProperty(proto, 'offsetWidth', width); else delete (proto as any).offsetWidth;
    }
  });
});
