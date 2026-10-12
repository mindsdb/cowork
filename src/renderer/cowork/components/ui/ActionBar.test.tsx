import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActionBar, shortcutHint } from './ActionBar';


describe('ActionBar', () => {
  it('orders the secondary before the filled primary, with the overflow trigger trailing', () => {
    render(
      <ActionBar
        leading={<p>Runs outside the sandbox</p>}
        secondary={{ label: 'Deny', onClick: vi.fn() }}
        primary={{ label: 'Allow once', onClick: vi.fn() }}
        overflow={[{ label: 'Always allow', onClick: vi.fn() }]}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual(['Deny', 'Allow once', 'More actions']);
    expect(screen.getByRole('button', { name: 'Allow once' })).toHaveClass('btn', 'primary');
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveClass('btn', 'subtle');
    expect(screen.getByText('Runs outside the sandbox')).toBeInTheDocument();
  });

  it('steps a three-answer bar ghost, outlined, filled', () => {
    render(<ActionBar tertiary={{ label: 'Deny' }} secondary={{ label: 'Always allow' }} primary={{ label: 'Allow once' }} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Deny', 'Always allow', 'Allow once']);
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveClass('subtle');
    expect(screen.getByRole('button', { name: 'Always allow' })).toHaveClass('default');
  });

  it('paints a danger tone as the destructive variant of each slot', () => {
    render(<ActionBar secondary={{ label: 'Discard', tone: 'danger' }} primary={{ label: 'Delete', tone: 'danger' }} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('danger-solid');
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveClass('danger');
  });

  it('fires the primary, the secondary and an overflow item', async () => {
    const user = userEvent.setup();
    const primary = vi.fn();
    const secondary = vi.fn();
    const always = vi.fn();
    render(<ActionBar primary={{ label: 'Allow once', onClick: primary }} secondary={{ label: 'Deny', onClick: secondary }} overflow={[false, { label: 'Always allow', onClick: always }]} />);

    await user.click(screen.getByRole('button', { name: 'Allow once' }));
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Always allow' }));

    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).toHaveBeenCalledOnce();
    expect(always).toHaveBeenCalledOnce();
  });

  it('holds a disabled or busy action', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ActionBar secondary={{ label: 'Cancel', onClick, disabled: true }} primary={{ label: 'Sending…', onClick, busy: true }} />);

    const busy = screen.getByRole('button', { name: 'Sending…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveClass('is-busy');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(busy);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces a shortcut and shows its key hint in the tooltip', async () => {
    const user = userEvent.setup();
    render(<ActionBar primary={{ label: 'Allow once', shortcut: 'Enter', tooltip: 'Runs this command' }} secondary={{ label: 'Details', expanded: false }} />);

    const allow = screen.getByRole('button', { name: 'Allow once' });
    expect(allow).toHaveAttribute('aria-keyshortcuts', 'Enter');
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    await user.hover(allow);
    expect(await screen.findByText('Runs this command')).toBeInTheDocument();
    expect(screen.getByText('↵').tagName).toBe('KBD');
  });

  it('opens the overflow from the keyboard and moves through its items', async () => {
    const user = userEvent.setup();
    const second = vi.fn();
    render(<ActionBar overflowLabel="More options" overflow={[{ label: 'First' }, { label: 'Second', onClick: second }]} />);

    screen.getByRole('button', { name: 'More options' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu', { name: 'More options' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(second).toHaveBeenCalledOnce();
  });

  it('renders nothing when it has nothing to show', () => {
    const { container } = render(<ActionBar overflow={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('writes key hints the way the app does', () => {
    expect(shortcutHint('Meta+Enter')).toBe('⌘↵');
    expect(shortcutHint('Escape')).toBe('Esc');
  });
});
