import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useArtifactCommentLayer } from './useArtifactCommentLayer';

// A harness, not a mock: a srcdoc-loaded iframe's contentWindow is exactly
// what the real draft preview hands this hook now that ArtifactViewer's
// draft-HTML branch renders the fetched document via `srcdoc` instead of
// navigating `src` (docs/artifact-collaboration-workflow/
// task-org-draft-preview-401.md). The bridge's trust check keys on
// `ev.source === iframe.contentWindow`, never on origin — an opaque srcdoc
// origin must not change that.
function Harness({ threads }) {
  const iframeRef = useRef(null);
  useArtifactCommentLayer(iframeRef, { threads, viewer: { id: 'u1' }, enabled: true });
  return <iframe ref={iframeRef} title="Draft preview" srcDoc="<html></html>" />;
}

describe('useArtifactCommentLayer postMessage bridge', () => {
  it('answers a ready announcement from a srcdoc iframe with the current thread list', () => {
    const threads = [{ id: 't1', status: 'open', created_at: '2026-01-01T00:00:00Z' }];
    render(<Harness threads={threads} />);
    const frame = screen.getByTitle('Draft preview');
    const postMessageSpy = vi.spyOn(frame.contentWindow, 'postMessage');

    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'anton-comments', type: 'ready' },
    }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'anton-comments',
        type: 'list',
        comments: [expect.objectContaining({ id: 't1' })],
      }),
      '*',
    );
  });

  it('ignores a same-shaped message whose source is not this iframe', () => {
    const threads = [{ id: 't1', status: 'open', created_at: '2026-01-01T00:00:00Z' }];
    render(<Harness threads={threads} />);
    const frame = screen.getByTitle('Draft preview');
    const postMessageSpy = vi.spyOn(frame.contentWindow, 'postMessage');

    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: { source: 'anton-comments', type: 'ready' },
    }));

    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
