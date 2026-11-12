import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserFrame, paneMayTakeFocus } from './BrowserFrame';

describe('BrowserFrame docked on a phone', () => {
  it('minimizes instead of closing, keeps the page mounted, and expands from its header', async () => {
    const onClose = vi.fn();
    const onToggle = vi.fn();
    const { rerender, container } = render(
      <BrowserFrame hint="kayak.com" onClose={onClose} dock={{ collapsed: false, onToggle }}><iframe title="page" /></BrowserFrame>,
    );
    expect(screen.queryByRole('button', { name: 'Close browser' })).not.toBeInTheDocument();
    expect(container.querySelector('.browser-panel-scrim')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Minimize browser' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    rerender(<BrowserFrame hint="kayak.com" onClose={onClose} dock={{ collapsed: true, onToggle }}><iframe title="page" /></BrowserFrame>);
    expect(container.querySelector('.browser-panel')).toHaveClass('is-docked', 'is-collapsed');
    expect(container.querySelector('iframe')).toBeInTheDocument();
    await userEvent.click(screen.getByText('kayak.com'));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('closes with its X everywhere else', async () => {
    const onClose = vi.fn();
    render(<BrowserFrame hint="" onClose={onClose} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Close browser' }).at(-1));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BrowserFrame expanded on a phone', () => {
  it('has no header of its own, only a floating Minimize', async () => {
    const onToggle = vi.fn();
    const { container } = render(<BrowserFrame hint="kayak.com" onClose={vi.fn()} dock={{ collapsed: false, onToggle }}><iframe title="page" /></BrowserFrame>);
    expect(container.querySelector('.browser-panel__header')).toBeNull();
    expect(screen.queryByText('Browser')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Minimize browser' }));
    expect(onToggle).toHaveBeenCalled();
  });
});

describe("the pane's privacy note on a phone", () => {
  const css = readFileSync(resolve(__dirname, 'browser-panel.css'), 'utf8');
  it('stays on the open pane, and folds away only with the bar', () => {
    expect(css).not.toMatch(/\.browser-panel\.is-docked \.browser-panel__note\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.browser-panel\.is-docked\.is-collapsed \.browser-panel__note\s*\{\s*display:\s*none/);
  });
});

describe('paneMayTakeFocus', () => {
  it('lets the pane take focus from the page body, from nothing, or from inside the pane, and never from elsewhere', () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <BrowserFrame hint="" onClose={vi.fn()}><iframe title="page" /><button type="button">Inside</button></BrowserFrame>
      </>,
    );
    const frame = screen.getByTitle('page');
    expect(document.activeElement).toBe(document.body);
    expect(paneMayTakeFocus(frame)).toBe(true);

    screen.getByRole('button', { name: 'Inside' }).focus();
    expect(paneMayTakeFocus(frame)).toBe(true);

    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    expect(paneMayTakeFocus(frame)).toBe(false);

    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null });
    try {
      expect(paneMayTakeFocus(frame)).toBe(true);
    } finally {
      delete document.activeElement;
    }
  });
});
