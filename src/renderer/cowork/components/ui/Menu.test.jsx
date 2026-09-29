// Anchored mode: the call site owns the trigger and the open state, so Base UI
// never wires dismissal and Menu supplies its own outside-press layer.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Menu } from './Menu';

const anchor = { top: 10, left: 10, right: 40, bottom: 30, width: 30, height: 20, x: 10, y: 10 };

describe('Menu in anchored mode', () => {
  it('closes on a press anywhere outside the popup', () => {
    const onClose = vi.fn();
    render(<Menu open anchor={anchor} onClose={onClose} items={[{ label: 'Rename' }]} />);
    const layer = [...document.body.children].find((el) => el.style.position === 'fixed');

    fireEvent.mouseDown(layer);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('paints the layer just under the popup, over the drag region', () => {
    render(<Menu open anchor={anchor} zIndex={120} onClose={vi.fn()} items={[{ label: 'Rename' }]} />);
    const layer = [...document.body.children].find((el) => el.style.position === 'fixed');

    expect(layer.style.zIndex).toBe('119');
    expect(layer.style.getPropertyValue('-webkit-app-region')
      || layer.style.WebkitAppRegion).toBe('no-drag');
  });

  it('renders no layer while closed', () => {
    render(<Menu open={false} anchor={anchor} onClose={vi.fn()} items={[{ label: 'Rename' }]} />);

    expect([...document.body.children].some((el) => el.style.position === 'fixed')).toBe(false);
  });

  it('leaves trigger mode to Base UI', () => {
    render(<Menu trigger={<button type="button">More</button>} items={[{ label: 'Rename' }]} />);

    fireEvent.click(screen.getByText('More'));

    expect([...document.body.children].some((el) => el.style.position === 'fixed')).toBe(false);
  });
});
