import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactModeTabs } from './ArtifactModeTabs';

describe('ArtifactModeTabs permissions', () => {
  it('explains a reviewer edit lock in the accessible name', () => {
    render(
      <ArtifactModeTabs
        value="preview"
        onChange={vi.fn()}
        canEdit={false}
        canReview
      />,
    );

    expect(screen.getByRole('tab', {
      name: 'Edit unavailable — Only the artifact owner can edit',
    })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Review' })).toBeEnabled();
  });

  it('does not misreport a permissions failure while tools are loading', () => {
    render(
      <ArtifactModeTabs
        value="preview"
        onChange={vi.fn()}
        canEdit={false}
        canReview={false}
        editDisabledReason="Loading editing tools…"
        reviewDisabledReason="Loading review tools…"
      />,
    );

    expect(screen.getByRole('tab', {
      name: 'Edit unavailable — Loading editing tools…',
    })).toBeDisabled();
    expect(screen.getByRole('tab', {
      name: 'Review unavailable — Loading review tools…',
    })).toBeDisabled();
  });
});
