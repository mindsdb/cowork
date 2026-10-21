/*
 * With live apps on, an unpublished full-stack app shares through "Share
 * with…" on its card, and cowork-server refuses to publish it as a page, so
 * the viewer's header offers no page Share for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
const published = vi.hoisted(() => ({ url: '' }));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: published.url,
    accessMode: 'private',
    artifactKey: 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    busy: false,
  }),
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
  useArtifactWorkspace: () => workspaceMock,
}));
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ publication }) => <div data-testid="publishable">{String(publication?.publishable)}</div>,
}));
vi.mock('./ArtifactViewerBody', () => ({ ArtifactViewerBody: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';
import { setLiveApps } from '../../../lib/liveApps';

const app = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Table Row Counts',
  type: 'fullstack-stateless-app',
  ext: '.html',
  path: '/artifacts/table-counts/static/index.html',
  canonicalPath: '/artifacts/table-counts/static/index.html',
  capabilities: { role: 'owner', canEdit: true },
};
const page = { ...app, type: 'html-app', title: 'Weekly KPIs', path: '/artifacts/weekly/index.html', canonicalPath: '/artifacts/weekly/index.html' };

const offersPageShare = () => screen.getByTestId('publishable').textContent === 'true';

describe('the viewer\'s page Share on a live app', () => {
  beforeEach(() => { published.url = ''; });
  afterEach(() => setLiveApps(false));

  it('is offered while live apps are off, as before', () => {
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);
    expect(offersPageShare()).toBe(true);
  });

  it('is not offered on an unpublished full-stack app with live apps on', () => {
    setLiveApps(true);
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);
    expect(offersPageShare()).toBe(false);
  });

  it('stays on a full-stack app already published, so it can be stopped', () => {
    setLiveApps(true);
    published.url = 'https://pages.example/a';
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);
    expect(offersPageShare()).toBe(true);
  });

  it('stays on a static page with live apps on', () => {
    setLiveApps(true);
    render(<ArtifactViewer open artifact={page} onClose={vi.fn()} />);
    expect(offersPageShare()).toBe(true);
  });
});
