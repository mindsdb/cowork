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

// History sits on the left with the revision it compares against (ENG-4455);
// the panels moved to the viewer's rail, so the line has no centre.
describe('ArtifactRevisionBar layout', () => {
  const REVISIONS = [{ id: 'rev-2', number: 2, summary: 'x' }, { id: 'rev-1', number: 1, summary: 'y' }];

  it('puts History beside the revision and its status, on the left', () => {
    render(
      <ArtifactRevisionBar revision={REVISIONS[0]} revisions={REVISIONS} status="ready" canEdit />,
    );

    const history = screen.getByRole('combobox', { name: /Compare/ });
    const identity = history.closest('.artifact-revision-identity');
    expect(identity).not.toBeNull();
    expect(identity).toHaveTextContent('Draft · Revision 2');
    expect(identity.firstElementChild).toHaveClass('artifact-draft-dot');
    expect(document.querySelector('.artifact-revision-center')).toBeNull();
    expect(document.querySelector('.artifact-revision-actions')).toBeNull();
  });

  it('keeps Save and Discard on the right, apart from History', () => {
    render(
      <ArtifactRevisionBar revision={REVISIONS[0]} revisions={REVISIONS} status="ready" dirty canEdit onSave={vi.fn()} onDiscard={vi.fn()} />,
    );

    const actions = document.querySelector('.artifact-revision-actions');
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Discard' }));
    expect(actions).not.toContainElement(screen.getByRole('combobox', { name: /Compare/ }));
    expect(actions.previousElementSibling).toHaveClass('artifact-revision-identity');
  });
});

describe('ArtifactRevisionBar save and discard', () => {
  const bar = (saveInEditor) => (
    <ArtifactRevisionBar
      revision={{ id: 'revision-4', number: 4 }}
      revisions={[]}
      status="ready"
      dirty
      canEdit
      saveInEditor={saveInEditor}
      onSave={vi.fn()}
      onDiscard={vi.fn()}
      onCompare={vi.fn()}
    />
  );

  it('offers Save and Discard for unsaved work', () => {
    render(bar(false));
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it("leaves them to the Live edit panel while it is on", () => {
    render(bar(true));
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });
});
