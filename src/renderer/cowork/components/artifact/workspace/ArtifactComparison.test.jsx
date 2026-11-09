import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inlineHtmlFromApi } from '../../../lib/inlineHtmlAssets';
import { ArtifactComparison } from './ArtifactComparison';

vi.mock('../../../../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:4000' },
}));
vi.mock('../../../lib/inlineHtmlAssets', () => ({ inlineHtmlFromApi: vi.fn() }));

const DRAFT_URL = '/api/v1/artifacts/drafts/p/a/deck.html';
const INLINED = '<!--inlined-->';

beforeEach(() => {
  inlineHtmlFromApi.mockReset();
});

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
  function renderHtmlComparison() {
    render(
      <ArtifactComparison
        comparison={HTML_COMPARISON}
        contentType="html"
        baseUrl={DRAFT_URL}
        busy={false}
        onClose={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
  }

  function paneDocument(title) {
    return screen.getByTitle(title).getAttribute('srcdoc');
  }

  it('shows the panes once both documents are inlined', async () => {
    const reads = [];
    inlineHtmlFromApi.mockImplementation((html) => new Promise((resolve) => {
      reads.push(() => resolve(`${html}${INLINED}`));
    }));

    renderHtmlComparison();
    expect(screen.queryByTitle('Artifact before Revision 4')).not.toBeInTheDocument();
    expect(screen.getAllByText('Loading page…')).toHaveLength(2);

    await act(async () => { reads[0](); });
    expect(screen.queryByTitle('Artifact after Revision 5')).not.toBeInTheDocument();

    await act(async () => { reads[1](); });
    expect(paneDocument('Artifact before Revision 4')).toContain(INLINED);
    expect(paneDocument('Artifact after Revision 5')).toContain(INLINED);
    expect(paneDocument('Artifact before Revision 4')).toContain(
      '<base href="http://127.0.0.1:4000/api/v1/artifacts/drafts/p/a/deck.html">',
    );
  });

  it('shows both panes when inlining one of them fails', async () => {
    inlineHtmlFromApi
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async (html) => `${html}${INLINED}`);

    renderHtmlComparison();

    expect(await screen.findByTitle('Artifact before Revision 4')).toBeInTheDocument();
    expect(paneDocument('Artifact before Revision 4')).not.toContain(INLINED);
    expect(paneDocument('Artifact after Revision 5')).toContain(INLINED);
  });

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
