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
