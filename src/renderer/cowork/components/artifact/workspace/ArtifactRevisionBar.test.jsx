import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactRevisionBar } from './ArtifactRevisionBar';

describe('ArtifactRevisionBar permissions', () => {
  it('keeps revision context visible while explaining reviewer access', () => {
    render(
      <ArtifactRevisionBar
        revision={{ id: 'revision-4', number: 4 }}
        revisions={[]}
        status="ready"
        dirty={false}
        canEdit={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCompare={vi.fn()}
      />,
    );

    expect(screen.getByText('Draft · Revision 4')).toBeVisible();
    expect(screen.getByText('View only · Only the owner can edit')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('ArtifactRevisionBar history picker', () => {
  const REVISIONS = [
    { id: 'rev-3', number: 3, summary: 'Rejected agent suggestion' },
    { id: 'rev-2', number: 2, summary: 'Agent updated artifact' },
    { id: 'rev-1', number: 1, summary: 'Agent updated artifact' },
  ];

  it('lists the current revision, so a just-written one is not missing', () => {
    // The list is newest-first and used to drop its head, so the revision a
    // reject had only just written was absent from the one place people look.
    render(
      <ArtifactRevisionBar
        revision={REVISIONS[0]}
        revisions={REVISIONS}
        status="ready"
        canEdit
      />,
    );

    const current = screen.getByRole('option', { name: /Revision 3 · Rejected agent suggestion \(current\)/ });
    expect(current).toBeDisabled();
  });

  it('offers every older revision to compare against', () => {
    render(
      <ArtifactRevisionBar
        revision={REVISIONS[0]}
        revisions={REVISIONS}
        status="ready"
        canEdit
      />,
    );

    expect(screen.getByRole('option', { name: /Revision 2/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Revision 1/ })).toBeEnabled();
  });
});
