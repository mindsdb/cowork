import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactComparison } from './ArtifactComparison';

const HTML_COMPARISON = {
  kind: 'agent',
  before: {
    id: 'before', number: 4, path: 'deck.html',
    content: '<html><body><h1>Before title</h1></body></html>',
  },
  after: {
    id: 'after', number: 5, path: 'deck.html',
    content: '<html><body><h1>After title</h1></body></html>',
  },
};

describe('ArtifactComparison', () => {
  it('shows a rendered HTML comparison before exposing source', async () => {
    const user = userEvent.setup();
    render(
      <ArtifactComparison
        comparison={HTML_COMPARISON}
        contentType="html"
        busy={false}
        onClose={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Artifact before Revision 4')).toBeInTheDocument();
    expect(screen.getByTitle('Artifact after Revision 5')).toBeInTheDocument();
    expect(screen.getByText('Before title')).toBeInTheDocument();
    expect(screen.getByText('After title')).toBeInTheDocument();
    expect(screen.queryByText('<html><body><h1>Before title</h1></body></html>')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByText('<html><body><h1>Before title</h1></body></html>')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visual comparison' })).toBeEnabled();
  });

  it('keeps plain text comparison direct', () => {
    render(
      <ArtifactComparison
        comparison={{
          kind: 'revision',
          before: { id: 'before', number: 2, path: 'notes.md', content: 'Before' },
          after: { id: 'after', number: 3, path: 'notes.md' },
          afterContent: 'After',
        }}
        contentType="md"
        busy={false}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Advanced' })).not.toBeInTheDocument();
  });
});
