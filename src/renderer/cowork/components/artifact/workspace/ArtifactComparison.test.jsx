import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inlineHtmlFromApi } from '../../../lib/inlineHtmlAssets';
import { ArtifactComparison } from './ArtifactComparison';
import { changeStepFromKey } from './ComparisonChangeNav';
import { HTML_COMPARISON_PARENT_SOURCE, HTML_COMPARISON_SOURCE } from './htmlComparisonRuntime';

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

  describe('jumping between changes', () => {
    // Three changes in reading order: an edited heading, a removed paragraph,
    // and the paragraph added in its place.
    const MULTI_COMPARISON = {
      kind: 'agent',
      before: {
        id: 'before', number: 4, path: 'deck.html',
        content: '<html><body><h1 id="t">Old title</h1><p id="k">Keep</p><p id="g">Gone</p></body></html>',
      },
      after: {
        id: 'after', number: 5, path: 'deck.html',
        content: '<html><body><h1 id="t">New title</h1><p id="k">Keep</p><p id="n">Added</p></body></html>',
      },
    };

    function renderComparison(comparison, contentType = 'html') {
      return render(
        <ArtifactComparison
          comparison={comparison}
          contentType={contentType}
          busy={false}
          onClose={vi.fn()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onRestore={vi.fn()}
        />,
      );
    }

    function frameSpies() {
      const frames = {
        before: screen.getByTitle('Artifact before Revision 4'),
        after: screen.getByTitle('Artifact after Revision 5'),
      };
      return Object.fromEntries(Object.entries(frames).map(([side, frame]) => [
        side,
        vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {}),
      ]));
    }

    function tokenOf(title) {
      return /const TOKEN = "([^"]+)"/.exec(screen.getByTitle(title).getAttribute('srcdoc'))[1];
    }

    it('counts the changes and wraps around at either end', async () => {
      const user = userEvent.setup();
      renderComparison(MULTI_COMPARISON);

      expect(screen.getByText('1 of 3 changes')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      expect(screen.getByText('2 of 3 changes')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      expect(screen.getByText('1 of 3 changes')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Previous change' }));
      expect(screen.getByText('3 of 3 changes')).toBeInTheDocument();
    });

    it('shows the summary of the change stepped to', async () => {
      const user = userEvent.setup();
      renderComparison(MULTI_COMPARISON);

      expect(screen.getByText('New title')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      expect(screen.getByText('Gone')).toBeInTheDocument();
    });

    it('asks each frame that has the change to scroll to it', async () => {
      const user = userEvent.setup();
      renderComparison(MULTI_COMPARISON);
      const spies = frameSpies();
      const token = tokenOf('Artifact after Revision 5');
      expect(tokenOf('Artifact before Revision 4')).toBe(token);

      // Each frame lines up on the first change once it has loaded.
      await waitFor(() => {
        for (const spy of Object.values(spies)) {
          expect(spy).toHaveBeenCalledWith(
            { source: HTML_COMPARISON_PARENT_SOURCE, token, type: 'goto', index: 0 },
            '*',
          );
        }
      });
      Object.values(spies).forEach((spy) => spy.mockClear());

      await user.click(screen.getByRole('button', { name: 'Next change' }));
      // Change 2 is a removal: only the before side has it.
      expect(spies.before).toHaveBeenCalledWith(
        { source: HTML_COMPARISON_PARENT_SOURCE, token, type: 'goto', index: 1 },
        '*',
      );
      expect(spies.after).not.toHaveBeenCalled();

      // Change 3 is an addition: only the after side has it.
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      expect(spies.after).toHaveBeenCalledWith(expect.objectContaining({ type: 'goto', index: 2 }), '*');
      expect(spies.before).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Next change' }));
      expect(spies.before).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }), '*');
      expect(spies.after).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }), '*');
    });

    it('steps with Alt+Arrow keys, and when a frame reports them', async () => {
      const user = userEvent.setup();
      renderComparison(MULTI_COMPARISON);
      const token = tokenOf('Artifact after Revision 5');

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
      expect(screen.getByText('2 of 3 changes')).toBeInTheDocument();
      await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
      expect(screen.getByText('1 of 3 changes')).toBeInTheDocument();

      const step = (data) => act(() => {
        window.dispatchEvent(new MessageEvent('message', { data }));
      });
      step({ source: HTML_COMPARISON_SOURCE, token, type: 'step', direction: -1 });
      expect(screen.getByText('3 of 3 changes')).toBeInTheDocument();
      step({ source: HTML_COMPARISON_SOURCE, token: 'guess', type: 'step', direction: 1 });
      expect(screen.getByText('3 of 3 changes')).toBeInTheDocument();
    });

    it('leaves Alt+Arrow alone in a text field', () => {
      const field = document.createElement('textarea');
      expect(changeStepFromKey({ key: 'ArrowDown', altKey: true, target: field })).toBe(0);
      expect(changeStepFromKey({ key: 'ArrowDown', altKey: true, target: document.body })).toBe(1);
      expect(changeStepFromKey({ key: 'ArrowUp', altKey: true, metaKey: true, target: document.body })).toBe(0);
    });

    it('is hidden when nothing changed', () => {
      renderComparison({
        ...HTML_COMPARISON,
        after: { ...HTML_COMPARISON.after, content: HTML_COMPARISON.before.content },
      });
      expect(screen.queryByRole('group', { name: 'Step through changes' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next change' })).not.toBeInTheDocument();
    });

    it('steps through separate edits in the source comparison and flashes them', async () => {
      const user = userEvent.setup();
      const { container } = renderComparison({
        kind: 'revision',
        before: { id: 'before', number: 2, path: 'notes.md', content: 'one\ntwo\nthree\nfour' },
        after: { id: 'after', number: 3, path: 'notes.md' },
        afterContent: 'one\nTWO\nthree\nFOUR',
      }, 'md');

      expect(screen.getByText('1 of 2 changes')).toBeInTheDocument();
      expect(container.querySelectorAll('.is-flashing')).toHaveLength(0);
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      expect(screen.getByText('2 of 2 changes')).toBeInTheDocument();
      const flashing = [...container.querySelectorAll('.is-flashing')].map((line) => line.textContent);
      expect(flashing).toEqual(['four', 'FOUR']);
    });

    it('starts again from the first change when switching to source', async () => {
      const user = userEvent.setup();
      renderComparison(MULTI_COMPARISON);
      await user.click(screen.getByRole('button', { name: 'Next change' }));
      await user.click(screen.getByRole('button', { name: 'Advanced' }));
      expect(screen.getByText('1 of 1 change')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
      expect(screen.getByText('1 of 1 change')).toBeInTheDocument();
    });
  });
});

// A change to a published artifact, reviewed before it goes live (ENG-4409).
describe('ArtifactComparison publish review', () => {
  const PUBLISH_COMPARISON = {
    kind: 'publish',
    before: { id: 'r1', number: 1, path: 'notes.md', content: '# Old title\n' },
    after: { id: 'r2', number: 2, path: 'notes.md', content: '# New title\n' },
    afterContent: '# New title\n',
    review: { replyId: 'qe-2' },
  };
  function renderReview(publishReview) {
    const onClose = vi.fn();
    render(
      <ArtifactComparison
        comparison={PUBLISH_COMPARISON}
        contentType="md"
        busy={false}
        onClose={onClose}
        publishReview={publishReview}
      />,
    );
    return { onClose };
  }

  // Changes not shared yet, opened with the artifact (ENG-4595).
  it('names the shared version and the draft, and offers Publish changes', () => {
    const onPublish = vi.fn();
    render(
      <ArtifactComparison
        comparison={{ ...PUBLISH_COMPARISON, review: { unshared: true } }}
        contentType="md"
        busy={false}
        onClose={vi.fn()}
        publishReview={{ onPublish, onKeepDraft: vi.fn() }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Changes not shared yet' })).toBeInTheDocument();
    expect(screen.getByText('Before · Shared version')).toBeInTheDocument();
    expect(screen.getByText('After · Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep as draft' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('offers Publish this change, Keep as draft and Undo instead of Restore', () => {
    const review = { onPublish: vi.fn(), onKeepDraft: vi.fn(), onUndo: vi.fn() };
    renderReview(review);

    expect(screen.getByRole('heading', { name: 'Review the change before publishing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore as new revision' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish this change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(review.onPublish).toHaveBeenCalledTimes(1);
    expect(review.onKeepDraft).toHaveBeenCalledTimes(1);
    expect(review.onUndo).toHaveBeenCalledTimes(1);
  });

  it('keeps the change as a draft when closed', () => {
    const review = { onPublish: vi.fn(), onKeepDraft: vi.fn() };
    const { onClose } = renderReview(review);

    fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
    expect(review.onKeepDraft).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no Undo without one, and shows publishing and its error', () => {
    renderReview({ busy: true, error: 'Update failed: offline', onPublish: vi.fn(), onKeepDraft: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep as draft' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Update failed: offline');
  });
});

// ENG-4687: a document's two versions show whole, side by side, each in the
// viewer's own document preview fed that revision's bytes.
vi.mock('../../../preview/DocumentPreview', () => ({
  DocumentPreview: ({ source }) => <div data-testid="document-side">{source.url}</div>,
}));

describe('ArtifactComparison of a document', () => {
  const documentFor = (revision) => (revision?.contentUrl
    ? { source: { url: revision.contentUrl, previewType: 'docx', filename: 'report' } }
    : null);
  const comparison = {
    kind: 'revision',
    before: { id: 'rev-1', number: 1, path: 'report.docx', binary: true, contentUrl: '/content/rev-1' },
    after: { id: 'rev-2', number: 2, path: 'report.docx', binary: true, contentUrl: '/content/rev-2' },
  };

  it('shows both versions in the document preview, with no text diff and no change count', () => {
    render(<ArtifactComparison comparison={comparison} documentFor={documentFor} onClose={vi.fn()} onRestore={vi.fn()} />);

    const sides = screen.getAllByTestId('document-side');
    expect(sides.map((side) => side.textContent)).toEqual(['/content/rev-1', '/content/rev-2']);
    expect(document.querySelector('.artifact-compare-grid pre')).toBeNull();
    expect(screen.queryByText(/changed line/)).toBeNull();
    // The same footer as any revision comparison.
    expect(screen.getByRole('button', { name: 'Restore as new revision' })).toBeInTheDocument();
  });

  it('keeps the text comparison where a side has no document to show', () => {
    render(<ArtifactComparison
      comparison={{ kind: 'revision', before: { id: 'r1', number: 1, content: 'a' }, after: { id: 'r2', number: 2, content: 'b' } }}
      documentFor={documentFor}
      onClose={vi.fn()}
    />);
    expect(screen.queryByTestId('document-side')).toBeNull();
    expect(document.querySelector('.artifact-compare-grid pre')).not.toBeNull();
  });
});
