import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SharedResourceAttribution from './SharedResourceAttribution';

describe('SharedResourceAttribution', () => {
  it('keeps creator, last editor, and an accessible timestamp visible', () => {
    const { container } = render(
      <SharedResourceAttribution
        resource={{
          attribution: {
            createdBy: { userId: 'creator', email: 'long.creator@example.com' },
            lastModifiedBy: { userId: 'editor', email: 'long.editor@example.com' },
            lastModifiedAt: '2026-08-29T11:00:00Z',
          },
        }}
      />,
    );

    expect(screen.getByText(/Created by long.creator@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Last modified by long.editor@example.com/)).toBeInTheDocument();
    const timestamp = container.querySelector('time');
    expect(timestamp).toHaveAttribute('datetime', '2026-08-29T11:00:00Z');
    expect(timestamp).not.toHaveTextContent(/^\s*$/);
    expect(container.firstChild).not.toHaveClass('truncate');
  });
});
