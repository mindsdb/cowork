import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserFrame } from './BrowserFrame';

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
