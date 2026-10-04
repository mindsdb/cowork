import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentsToolbar } from './CommentsToolbar';

const MODE_LABEL = 'Comment — click an element (⌥ selects the container)';

function renderToolbar(props = {}) {
  const handlers = {
    onToggleMode: vi.fn(),
    onToggleInbox: vi.fn(),
    onToggleMarkers: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <CommentsToolbar
      mode={false}
      inboxOpen={false}
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
    ['Comments inbox', 'onToggleInbox'],
    ['Hide comment', 'onToggleMarkers'],
    ['Close comments', 'onClose'],
  ])('"%s" calls only %s', async (name, handler) => {
    const handlers = renderToolbar();

    await userEvent.click(screen.getByRole('button', { name }));

    for (const [key, fn] of Object.entries(handlers)) {
      expect(fn).toHaveBeenCalledTimes(key === handler ? 1 : 0);
    }
  });

  it('reflects comment mode and inbox state through aria-pressed', () => {
    renderToolbar({ mode: true, inboxOpen: false });

    expect(screen.getByRole('button', { name: MODE_LABEL })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Comments inbox' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers to show markers once they are hidden', () => {
    renderToolbar({ markersShown: false });

    expect(screen.getByRole('button', { name: 'Show comment' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Hide comment' })).not.toBeInTheDocument();
  });
});
