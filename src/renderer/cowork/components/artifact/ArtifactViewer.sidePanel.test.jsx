// The comments inbox and Stats share one docked slot, and comment mode is off
// while Stats is open, so at most one header switch is on at a time.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const publishMock = vi.hoisted(() => ({ url: '', accessMode: 'restricted', accessLoaded: true }));
const workspaceMock = vi.hoisted(() => ({ mode: 'preview' }));
const statsMock = vi.hoisted(() => ({ enabled: [], value: null }));
const layerMock = vi.hoisted(() => ({ exitMode: vi.fn() }));
const analyticsMock = vi.hoisted(() => ({ trackArtifactStatsOpened: vi.fn() }));

vi.mock('../../api', () => ({
  fetchPublishStats: vi.fn(),
  setPublishTracking: vi.fn(),
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: 'http://localhost/preview' })),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn() }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactStats: vi.fn(),
  setArtifactTracking: vi.fn(),
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('../../lib/analytics', () => analyticsMock);
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
  usePublish: () => ({
    publishedUrl: publishMock.url,
    accessMode: publishMock.accessMode,
    accessLoaded: publishMock.accessLoaded,
    artifactKey: 'artifact/cccccccc-cccc-cccc-cccc-cccccccccccc',
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
  // Stable, like the real hook's callback: the review/edit effect depends on it.
  useArtifactCommentLayer: () => layerMock,
}));
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => ({
    supported: false, mode: workspaceMock.mode, setMode: vi.fn(), revisions: [],
    capabilities: null, commentsReady: true, status: 'idle', repair: null,
    refreshRepair: vi.fn(), releaseRepairsForComment: vi.fn(),
  }),
}));
vi.mock('./stats/useArtifactStats', () => ({
  useArtifactStats: (_artifact, { enabled }) => {
    statsMock.enabled.push(enabled);
    return statsMock.value;
  },
}));
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ review, stats }) => (
    <>
      <button type="button" aria-pressed={!!review.open} onClick={review.onToggle}>Comments</button>
      <button type="button" aria-pressed={!!stats.open} onClick={stats.onToggle}>Stats</button>
    </>
  ),
}));
vi.mock('./ArtifactViewerBody', () => ({
  ArtifactViewerBody: ({ review, stats }) => (
    <>
      <output
        data-testid="panels"
        data-comments={String(!!review.open)}
        data-inbox={String(!!(review.open && review.inboxOpen))}
        data-stats={String(!!stats?.open)}
      />
      <button type="button" onClick={() => review.setInboxOpen(true)}>Open inbox</button>
    </>
  ),
}));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, children }) => (open ? <div>{children}</div> : null),
}));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const CARD = {
  // Dashed on purpose: the event carries the normalized bare-hex identity.
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  title: 'C',
  type: 'document',
  ext: '.html',
  path: '/artifacts/c/index.html',
};

const CARD_ID = 'cccccccccccccccccccccccccccccccc';

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const panels = () => screen.getByTestId('panels').dataset;
const click = (name) => fireEvent.click(screen.getByRole('button', { name }));

function renderViewer() {
  const props = { open: true, artifact: CARD, onClose: vi.fn(), onChange: vi.fn() };
  const view = render(<ArtifactViewer {...props} />);
  return () => view.rerender(<ArtifactViewer {...props} />);
}

beforeEach(() => {
  publishMock.url = 'https://view.example/a/1';
  publishMock.accessMode = 'restricted';
  publishMock.accessLoaded = true;
  workspaceMock.mode = 'preview';
  statsMock.enabled = [];
  statsMock.value = {
    data: null, loading: false, error: null, trackingBusy: false,
    reload: vi.fn(), setTracking: vi.fn(),
  };
  layerMock.exitMode.mockClear();
  analyticsMock.trackArtifactStatsOpened.mockClear();
});

describe('ArtifactViewer side panel', () => {
  it('turns comment mode and the inbox off when Stats opens', async () => {
    renderViewer();
    await settle();
    click('Comments');
    click('Open inbox');
    expect(panels()).toMatchObject({ comments: 'true', inbox: 'true', stats: 'false' });

    click('Stats');

    expect(panels()).toMatchObject({ comments: 'false', inbox: 'false', stats: 'true' });
    expect(layerMock.exitMode).toHaveBeenCalled();
  });

  it('closes Stats from the Comments button', async () => {
    renderViewer();
    await settle();
    click('Stats');

    click('Comments');

    expect(panels()).toMatchObject({ comments: 'true', stats: 'false' });
  });

  it('closes Stats when the inbox opens', async () => {
    renderViewer();
    await settle();
    click('Stats');

    click('Open inbox');

    expect(panels().stats).toBe('false');
  });

  it('opens Comments and closes Stats on entering review mode', async () => {
    const rerender = renderViewer();
    await settle();
    click('Stats');

    workspaceMock.mode = 'review';
    rerender();
    await settle();

    expect(panels()).toMatchObject({ comments: 'true', inbox: 'true', stats: 'false' });
  });

  it('closes both panels on entering edit mode', async () => {
    const rerender = renderViewer();
    await settle();
    click('Comments');
    click('Open inbox');

    workspaceMock.mode = 'edit';
    rerender();
    await settle();
    expect(panels()).toMatchObject({ comments: 'false', inbox: 'false', stats: 'false' });

    workspaceMock.mode = 'preview';
    rerender();
    click('Stats');
    workspaceMock.mode = 'edit';
    rerender();
    await settle();
    expect(panels().stats).toBe('false');
  });

  it('loads stats only while the panel is open', async () => {
    renderViewer();
    await settle();
    expect(statsMock.enabled.at(-1)).toBe(false);

    click('Stats');
    expect(statsMock.enabled.at(-1)).toBe(true);

    click('Stats');
    expect(statsMock.enabled.at(-1)).toBe(false);
  });

  it('does not open Stats for an unpublished artifact', async () => {
    publishMock.url = '';
    renderViewer();
    await settle();

    click('Stats');
    await settle();

    expect(statsMock.enabled.at(-1)).toBe(false);
    expect(panels().stats).toBe('false');
  });

  it('closes Stats when the artifact stops being published', async () => {
    const rerender = renderViewer();
    await settle();
    click('Stats');

    publishMock.url = '';
    rerender();
    await settle();

    expect(panels().stats).toBe('false');
  });
});

describe('ArtifactViewer stats analytics', () => {
  const track = () => analyticsMock.trackArtifactStatsOpened;

  it('reports the first successful load of each open, once', async () => {
    const rerender = renderViewer();
    await settle();
    click('Stats');
    expect(track()).not.toHaveBeenCalled();

    statsMock.value = { ...statsMock.value, data: { total_views: 3 } };
    rerender();
    await settle();
    expect(track()).toHaveBeenCalledTimes(1);
    expect(track()).toHaveBeenCalledWith({
      artifactId: CARD_ID,
      accessMode: 'restricted',
      hasViews: true,
    });

    rerender();
    await settle();
    expect(track()).toHaveBeenCalledTimes(1);

    click('Stats');
    statsMock.value = { ...statsMock.value, data: null };
    rerender();
    click('Stats');
    statsMock.value = { ...statsMock.value, data: { total_views: 0 } };
    rerender();
    await settle();

    expect(track()).toHaveBeenCalledTimes(2);
    expect(track()).toHaveBeenLastCalledWith({
      artifactId: CARD_ID,
      accessMode: 'restricted',
      hasViews: false,
    });
  });

  // usePublish reports 'public' until the real access mode loads.
  it('sends a null access mode until access has loaded', async () => {
    publishMock.accessMode = 'public';
    publishMock.accessLoaded = false;
    const rerender = renderViewer();
    await settle();
    click('Stats');

    statsMock.value = { ...statsMock.value, data: { total_views: 5 } };
    rerender();
    await settle();

    expect(track()).toHaveBeenCalledWith({ artifactId: CARD_ID, accessMode: null, hasViews: true });
  });

  // The viewer stays mounted when the host swaps the artifact on screen.
  it('reports again for another artifact opened with the panel still open', async () => {
    const OTHER = { ...CARD, id: 'dddddddddddddddddddddddddddddddd', path: '/artifacts/d/index.html' };
    const props = { open: true, onClose: vi.fn(), onChange: vi.fn() };
    const view = render(<ArtifactViewer {...props} artifact={CARD} />);
    await settle();
    click('Stats');
    statsMock.value = { ...statsMock.value, data: { total_views: 3 } };
    view.rerender(<ArtifactViewer {...props} artifact={CARD} />);
    await settle();
    expect(track()).toHaveBeenCalledTimes(1);

    // The real hook returns no data for an artifact it has not loaded yet.
    statsMock.value = { ...statsMock.value, data: null };
    view.rerender(<ArtifactViewer {...props} artifact={OTHER} />);
    await settle();
    expect(track()).toHaveBeenCalledTimes(1);

    statsMock.value = { ...statsMock.value, data: { total_views: 0 } };
    view.rerender(<ArtifactViewer {...props} artifact={OTHER} />);
    await settle();

    expect(track()).toHaveBeenCalledTimes(2);
    expect(track()).toHaveBeenLastCalledWith({
      artifactId: 'dddddddddddddddddddddddddddddddd',
      accessMode: 'restricted',
      hasViews: false,
    });
  });
});
