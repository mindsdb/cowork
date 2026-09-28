// A late onChange must not reopen a closed viewer (ENG-3070).
//
// Hosts keep the previewed artifact in state and write every onChange back into
// it, so `open` is derived from that state. The publish hook's status refresh
// settles asynchronously — on open and on every window focus, which on web
// fires when the user clicks the page after the iframe had focus — so its
// report can land after the user closed the viewer and turn `null` back into
// an artifact.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const publishMock = vi.hoisted(() => ({ onChange: null }));

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: '/preview' })),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn() }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'http://localhost',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('./publish/usePublish', () => ({
  usePublish: (_artifact, { onChange }) => {
    publishMock.onChange = onChange;
    return { publishedUrl: '', accessMode: 'public', artifactKey: '', busy: false };
  },
}));
vi.mock('./comments', () => ({
  useArtifactComments: () => ({
    threads: [], viewer: null, unreadCount: 0,
    create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(),
    editThread: vi.fn(), deleteThread: vi.fn(), editReply: vi.fn(),
    deleteReply: vi.fn(), markRead: vi.fn(),
  }),
  useArtifactCommentLayer: () => ({ exitMode: vi.fn() }),
}));
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => ({
    supported: false, mode: 'preview', setMode: vi.fn(), revisions: [],
    capabilities: null, commentsReady: false, status: 'idle', repair: null,
    refreshRepair: vi.fn(), releaseRepairsForComment: vi.fn(),
  }),
}));
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ onClose }) => <button onClick={onClose}>Close</button>,
}));
vi.mock('./ArtifactViewerBody', () => ({ ArtifactViewerBody: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, children }) => (open ? <div data-testid="viewer">{children}</div> : null),
}));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const A = { id: 'a1', title: 'A', type: 'document', ext: '.html', path: '/artifacts/a/index.html' };
const B = { id: 'b1', title: 'B', type: 'document', ext: '.html', path: '/artifacts/b/index.html' };

let openArtifact;

// Mirrors ChatView's wiring: open derives from the state onChange writes.
function Host() {
  const [previewArt, setPreviewArt] = useState(null);
  openArtifact = setPreviewArt;
  return (
    <ArtifactViewer
      open={!!previewArt}
      artifact={previewArt}
      onClose={() => setPreviewArt(null)}
      onChange={(updated) => setPreviewArt(updated)}
    />
  );
}

describe('ArtifactViewer late onChange', () => {
  beforeEach(() => { publishMock.onChange = null; });

  it('forwards changes while the viewer is open', () => {
    render(<Host />);
    act(() => openArtifact(A));
    act(() => publishMock.onChange({ ...A, title: 'A, renamed' }));
    expect(screen.getByTestId('viewer')).toBeTruthy();
  });

  it('stays closed when a refresh settles after close', () => {
    render(<Host />);
    act(() => openArtifact(A));
    const lateReport = publishMock.onChange;

    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('viewer')).toBeNull();

    act(() => lateReport({ ...A, accessMode: 'restricted', accessEmails: ['x@y.com'] }));
    expect(screen.queryByTestId('viewer')).toBeNull();
  });

  it('ignores a report for the artifact the viewer moved away from', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ArtifactViewer open artifact={A} onClose={vi.fn()} onChange={onChange} />);
    const lateReport = publishMock.onChange;

    rerender(<ArtifactViewer open artifact={B} onClose={vi.fn()} onChange={onChange} />);
    act(() => lateReport({ ...A, accessMode: 'restricted' }));
    expect(onChange).not.toHaveBeenCalled();

    act(() => publishMock.onChange({ ...B, accessMode: 'restricted' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });
});
