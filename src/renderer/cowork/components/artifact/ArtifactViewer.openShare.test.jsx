/*
 * A Share clicked outside the viewer (the chat's artifact card) opens the
 * viewer with its Share panel showing, and the sharing events name where.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const workspaceMock = vi.hoisted(() => ({
  supported: true,
  mode: 'preview',
  setMode: vi.fn(),
  source: null,
  currentRevision: null,
  revisions: [],
  capabilities: null,
  capabilitiesFromServer: false,
  commentsReady: true,
  status: 'ready',
  dirty: false,
  error: '',
  conflict: null,
  repair: null,
  save: vi.fn(),
  discard: vi.fn(),
  compareRevision: vi.fn(),
  refreshRepair: vi.fn(),
  addressWithAgent: vi.fn(),
  cancelRepair: vi.fn(),
}));

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: '/preview' })),
  fetchMyLiveApps: vi.fn(async () => new Map()),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(async () => undefined),
}));
vi.mock('../../lib/artifactsStore', () => ({
  deleteArtifactAndSync: vi.fn(async () => undefined),
}));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: false,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'http://localhost',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
const published = vi.hoisted(() => ({ url: '', options: null }));
vi.mock('./publish/usePublish', () => ({
  usePublish: (_artifact, options) => (published.options = options, {
    publishedUrl: published.url,
    accessMode: 'private',
    artifactKey: 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    busy: false,
  }),
}));
const layer = vi.hoisted(() => ({ options: null }));
vi.mock('./comments', () => ({
  useArtifactComments: () => ({
    threads: [], viewer: null, unreadCount: 0,
    create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(),
    editThread: vi.fn(), deleteThread: vi.fn(), editReply: vi.fn(),
    deleteReply: vi.fn(), markRead: vi.fn(),
  }),
  useArtifactCommentLayer: (_frame, options) => { layer.options = options; return { exitMode: vi.fn() }; },
}));
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => workspaceMock,
}));
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ publication }) => (
    <div data-testid="open-share">{String(publication?.openShare)}</div>
  ),
}));
vi.mock('./ArtifactViewerBody', () => ({ ArtifactViewerBody: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const page = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Weekly KPIs',
  type: 'html-app',
  ext: '.html',
  path: '/artifacts/weekly/index.html',
  canonicalPath: '/artifacts/weekly/index.html',
  capabilities: { role: 'owner', canEdit: true },
};

describe('opening the viewer from a Share outside it', () => {
  beforeEach(() => { published.options = null; });
  afterEach(() => { published.url = ''; });

  it('asks the header for the Share panel and names the entry for the sharing events', () => {
    render(<ArtifactViewer open artifact={page} onClose={vi.fn()} openShare shareEntry="chat_card" />);

    expect(screen.getByTestId('open-share')).toHaveTextContent('true');
    expect(published.options).toMatchObject({ entry: 'chat_card' });
  });

  it('opens as the viewer by default', () => {
    render(<ArtifactViewer open artifact={page} onClose={vi.fn()} />);

    expect(screen.getByTestId('open-share')).toHaveTextContent('false');
    expect(published.options).toMatchObject({ entry: 'viewer' });
  });
});
