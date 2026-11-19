import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentsToolbar } from './CommentsToolbar';

// Comments' Navigate / Comment switch (ENG-4383), Live edit's twin.
describe('CommentsToolbar', () => {
  it('shows Navigate pressed outside placement mode, and Comment inside it', () => {
    const { rerender } = render(<CommentsToolbar mode={false} onChangeMode={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Navigate' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<CommentsToolbar mode onChangeMode={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to Comment and back to Navigate', async () => {
    const onChangeMode = vi.fn();
    const { rerender } = render(<CommentsToolbar mode={false} onChangeMode={onChangeMode} />);
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(onChangeMode).toHaveBeenLastCalledWith(true);

    rerender(<CommentsToolbar mode onChangeMode={onChangeMode} />);
    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    expect(onChangeMode).toHaveBeenLastCalledWith(false);
  });

  it('does nothing when the pressed mode is clicked again', async () => {
    const onChangeMode = vi.fn();
    render(<CommentsToolbar mode={false} onChangeMode={onChangeMode} />);
    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    expect(onChangeMode).not.toHaveBeenCalled();
  });

  it('has no hide, show, close or inbox controls', () => {
    render(<CommentsToolbar mode={false} onChangeMode={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
