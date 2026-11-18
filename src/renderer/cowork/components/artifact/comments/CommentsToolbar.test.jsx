import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentsToolbar } from './CommentsToolbar';

const MODE_LABEL = 'Comment — click an element (⌥ selects the container)';

function renderToolbar(props = {}) {
  const handlers = {
    onToggleMode: vi.fn(),
    onToggleMarkers: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <CommentsToolbar
      mode={false}
      markersShown
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('CommentsToolbar', () => {
  it.each([
    [MODE_LABEL, 'onToggleMode'],
    ['Hide comments', 'onToggleMarkers'],
    ['Close comments', 'onClose'],
  ])('"%s" calls only %s', async (name, handler) => {
    const handlers = renderToolbar();

    await userEvent.click(screen.getByRole('button', { name }));

    for (const [key, fn] of Object.entries(handlers)) {
      expect(fn).toHaveBeenCalledTimes(key === handler ? 1 : 0);
    }
  });

  it('reflects comment mode through aria-pressed', () => {
    renderToolbar({ mode: true });

    expect(screen.getByRole('button', { name: MODE_LABEL })).toHaveAttribute('aria-pressed', 'true');
  });

  // The Comments toggle opens the inbox with the pill, so the pill offers no
  // inbox button of its own.
  it('has no inbox button', () => {
    renderToolbar();

    expect(screen.queryByRole('button', { name: 'Comments inbox' })).not.toBeInTheDocument();
  });

  it('offers to show markers once they are hidden', () => {
    renderToolbar({ markersShown: false });

    expect(screen.getByRole('button', { name: 'Show comments' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Hide comments' })).not.toBeInTheDocument();
  });
});
