import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card, CardRow, cardClasses, cardActivationProps } from './Card';

describe('cardClasses', () => {
  it('is just "card" with no options', () => {
    expect(cardClasses()).toBe('card');
    expect(cardClasses({})).toBe('card');
  });

  it('emits the right compound modifier tokens', () => {
    const cls = cardClasses({
      interactive: true, selected: true, tinted: true,
      flat: true, variant: 'glass', padding: 'cozy', className: 'extra',
    });
    for (const t of ['card', 'interactive', 'selected', 'tinted', 'glass', 'flat', 'cozy', 'extra']) {
      expect(cls.split(' ')).toContain(t);
    }
  });

  it('ignores tinted unless selected', () => {
    expect(cardClasses({ tinted: true }).split(' ')).not.toContain('tinted');
    expect(cardClasses({ selected: true, tinted: true }).split(' ')).toContain('tinted');
  });

  it('drops unknown variant/padding instead of leaking junk classes', () => {
    expect(cardClasses({ variant: 'sparkly', padding: 'xxl' })).toBe('card');
  });

  it('maps padding names to their classes; default adds nothing', () => {
    expect(cardClasses({ padding: 'default' })).toBe('card');
    expect(cardClasses({ padding: 'compact' })).toBe('card compact');
    expect(cardClasses({ padding: 'snug' })).toBe('card snug');
    expect(cardClasses({ padding: 'none' })).toBe('card pad-none');
  });
});

describe('cardActivationProps', () => {
  it('returns nothing without onActivate', () => {
    expect(cardActivationProps()).toEqual({});
    expect(cardActivationProps({ as: 'div' })).toEqual({});
  });

  it('for a native button, wires only onClick (native handles keys)', () => {
    const onActivate = vi.fn();
    const props = cardActivationProps({ as: 'button', onActivate });
    expect(props).toEqual({ onClick: onActivate });
    expect(props.role).toBeUndefined();
  });

  it('for a non-button, adds role/tabIndex and fires on Enter/Space only', () => {
    const onActivate = vi.fn();
    const props = cardActivationProps({ as: 'div', onActivate });
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);

    const ev = (key) => ({ key, preventDefault: vi.fn() });
    const enter = ev('Enter'); props.onKeyDown(enter);
    const space = ev(' ');     props.onKeyDown(space);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(space.preventDefault).toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledTimes(2);

    const other = ev('a'); props.onKeyDown(other);
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledTimes(2); // unchanged
  });
});

describe('Card', () => {
  it('renders a <div> by default', () => {
    render(<Card>Panel</Card>);
    const el = screen.getByText('Panel');
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('card', { exact: true });
  });

  it('renders as a native button with type=button when as="button"', () => {
    render(<Card as="button" interactive onClick={() => {}}>Go</Card>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass('card', 'interactive');
  });

  it('activates a non-button interactive card via click and keyboard', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<Card interactive onActivate={onActivate}>Open me</Card>);
    const el = screen.getByRole('button', { name: 'Open me' });
    await user.click(el);
    el.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('passes className through alongside the card tokens', () => {
    render(<Card interactive className="cw-artifact-card">x</Card>);
    const el = screen.getByText('x');
    expect(el).toHaveClass('card', 'interactive', 'cw-artifact-card');
  });

  it('forwards its ref to the underlying element', () => {
    const ref = { current: null };
    render(<Card ref={ref}>y</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe('CardRow', () => {
  it('is "card-row" by default and adds "selected"', () => {
    render(<CardRow>row</CardRow>);
    expect(screen.getByText('row')).toHaveClass('card-row', { exact: true });
    render(<CardRow selected className="grid">sel</CardRow>);
    expect(screen.getByText('sel')).toHaveClass('card-row', 'selected', 'grid');
  });

  it('wires activation like Card', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<CardRow onActivate={onActivate}>r</CardRow>);
    await user.click(screen.getByRole('button', { name: 'r' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
