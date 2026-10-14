// A comment key that arrives after the preview painted must not reload it
// (ENG-3070).
//
// The comment bridge is baked into the preview URL. The key that enables it
// can come from the publish hook's status refresh, which on a slow connection
// settles after the iframe has loaded. Swapping `src` then reloads the page
// the user is looking at.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const publishMock = vi.hoisted(() => ({ key: '' }));
const bodyMock = vi.hoisted(() => ({ urls: [] }));

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: 'http://localhost/preview' })),
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
  usePublish: () => ({ publishedUrl: '', accessMode: 'public', artifactKey: publishMock.key, busy: false }),
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
    capabilities: null, commentsReady: true, status: 'idle', repair: null,
    refreshRepair: vi.fn(), releaseRepairsForComment: vi.fn(),
  }),
}));
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ review }) => <button onClick={review.onToggle}>Comments</button>,
}));
vi.mock('./ArtifactViewerBody', () => ({
  ArtifactViewerBody: ({ preview }) => {
    const previewUrl = preview?.url;
    if (previewUrl && bodyMock.urls.at(-1) !== previewUrl) bodyMock.urls.push(previewUrl);
    return null;
  },
}));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, children }) => (open ? <div>{children}</div> : null),
}));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { mountArtifactPreview } from '../../api';
import { ArtifactViewer } from './ArtifactViewer';

// A chat-card artifact: no id, so the viewer can't derive the comment key.
const CARD = { title: 'C', type: 'document', ext: '.html', path: '/artifacts/c/index.html' };
const KEY = 'artifact/cccccccc-cccc-cccc-cccc-cccccccccccc';

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function renderViewer() {
  const props = { open: true, artifact: CARD, onClose: vi.fn(), onChange: vi.fn() };
  const view = render(<ArtifactViewer {...props} />);
  return () => view.rerender(<ArtifactViewer {...props} />);
}

describe('ArtifactViewer comment layer', () => {
  beforeEach(() => {
    publishMock.key = '';
    bodyMock.urls = [];
    mountArtifactPreview.mockClear();
  });

  it('keeps the painted preview when the comment key arrives late', async () => {
    const rerender = renderViewer();
    await settle();
    expect(bodyMock.urls).toHaveLength(1);

    publishMock.key = KEY;
    rerender();
    await settle();

    expect(mountArtifactPreview).toHaveBeenCalledTimes(1);
    expect(bodyMock.urls).toHaveLength(1);
  });

  it('reloads with the bridge once the user opens comments', async () => {
    const rerender = renderViewer();
    await settle();
    publishMock.key = KEY;
    rerender();
    await settle();

    fireEvent.click(screen.getByText('Comments'));
    await settle();

    expect(bodyMock.urls).toHaveLength(2);
    expect(bodyMock.urls[1]).toContain('__antonComments=1');

    fireEvent.click(screen.getByText('Comments'));
    fireEvent.click(screen.getByText('Comments'));
    await settle();
    expect(bodyMock.urls).toHaveLength(2);
  });
});
