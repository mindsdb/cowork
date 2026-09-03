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

  it('renders no leading separator for a last-modified-only resource', () => {
    const { container } = render(
      <SharedResourceAttribution
        resource={{
          attribution: {
            createdBy: null,
            lastModifiedBy: { userId: 'editor', email: 'editor@example.com' },
            lastModifiedAt: null,
          },
        }}
      />,
    );

    expect(container.textContent.trim()).toBe('Last modified by editor@example.com');
    expect(container.textContent).not.toContain('·');
  });

  it('separates only the parts that exist', () => {
    const { container } = render(
      <SharedResourceAttribution
        resource={{
          attribution: {
            createdBy: null,
            lastModifiedBy: { userId: 'editor', email: 'editor@example.com' },
            lastModifiedAt: '2026-08-29T11:00:00Z',
          },
        }}
      />,
    );

    expect(container.textContent.trim().startsWith('·')).toBe(false);
    expect(container.textContent.match(/·/g)).toHaveLength(1);
  });

  it('names an unnamed actor instead of leaking a raw user id', () => {
    const id = '6f0d2e4a-4d4a-4d0e-93f6-9c4a1f2b7e10';
    const { container } = render(
      <SharedResourceAttribution
        resource={{
          attribution: {
            createdBy: { userId: id, email: null },
            lastModifiedBy: null,
            lastModifiedAt: null,
          },
        }}
      />,
    );

    expect(container.textContent).not.toContain(id);
    expect(screen.getByText(/Created by Another member/)).toBeInTheDocument();
  });

  it('renders a fully unidentified actor as Unknown', () => {
    render(
      <SharedResourceAttribution
        resource={{
          attribution: {
            createdBy: {},
            lastModifiedBy: null,
            lastModifiedAt: null,
          },
        }}
      />,
    );

    expect(screen.getByText(/Created by Unknown/)).toBeInTheDocument();
  });
});
