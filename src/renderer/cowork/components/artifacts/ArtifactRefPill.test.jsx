import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const CARD = vi.hoisted(() => ({ id: 'a1', slug: 'notes-1', title: 'Notes', type: 'document', ext: '.md', path: '/x/notes.md' }));
vi.mock('../../lib/artifactsStore', () => ({ useArtifactCardBySlug: (slug) => (slug === CARD.slug ? CARD : null) }));

import { ArtifactRefPill } from './ArtifactRefPill';

describe('ArtifactRefPill', () => {
  it('shows the stored title and opens the card', () => {
    const onOpen = vi.fn();
    render(<ArtifactRefPill slug="notes-1" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Notes' }));
    expect(onOpen).toHaveBeenCalledWith(CARD);
  });

  it('falls back to the given title, then the slug, and is not a button then', () => {
    const { rerender } = render(<ArtifactRefPill slug="other-2" fallbackTitle="Other" onOpen={vi.fn()} />);
    expect(screen.getByText('Other')).toBeInTheDocument();
    rerender(<ArtifactRefPill slug="other-2" onOpen={vi.fn()} />);
    expect(screen.getByText('other-2')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
