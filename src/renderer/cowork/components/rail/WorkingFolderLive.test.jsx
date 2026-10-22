/*
 * Where a click in the artifacts rail lands, per deployment.
 *
 * The rail is the third surface that renders an artifact body, and it was the
 * only one with no test of its own — lib/artifactSurfaces.test.js asserts that
 * this file asks `artifactOpenTarget`, which a caller passing the wrong answer
 * still satisfies. Replacing `canPreviewDraft` with `false` here left the whole
 * renderer suite green, so the org-mode routing had nothing behind it: a click
 * would go back to the browser tab ENG-2066 is about, or to nothing at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const FIXTURES = load(readFileSync(resolve(import.meta.dirname, '../../lib/artifactSurfaces.yaml'), 'utf-8'));

const openExternal = vi.fn();
const openPath = vi.fn();
// Async on purpose: the component AWAITS this. A sync `() => true` makes
// `await x` and `x` indistinguishable, so stripping the await stayed green
// (review pass 2). With a promise, a dropped await turns `!(Promise)` into
// false and the failure-path test below catches it.
const downloadArtifactFile = vi.fn(async () => true);

vi.mock('../../api', () => ({
  fetchActiveProject: vi.fn(() => Promise.resolve(null)),
  fetchArtifacts: vi.fn(() => Promise.resolve([])),
  fetchProjects: vi.fn(() => Promise.resolve([])),
  unpublishArtifact: vi.fn(),
}));
// Mutable so individual tests can flip the desktop half of the gates —
// with a hard-coded literal, `!canOpenLocalFile` was unverifiable here.
const hostState = vi.hoisted(() => ({ isWeb: true, isElectron: false, localApi: false }));
vi.mock('../../../platform/host', () => ({
  host: {
    get isWeb() { return hostState.isWeb; },
    get isElectron() { return hostState.isElectron; },
    isLocalApiOrigin: () => hostState.localApi,
    getApiOrigin: () => 'https://cowork.example',
    openExternal: (...a) => openExternal(...a),
    openPath: (...a) => openPath(...a),
  },
}));
vi.mock('../artifact', () => ({
  ArtifactViewer: ({ open, artifact }) => (open
    ? <div data-testid="artifact-viewer">{artifact.title}</div>
    : null),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({
  downloadArtifactFile: (...a) => downloadArtifactFile(...a),
}));
// The shared document gate, stubbed per test.
const canPreviewDocument = vi.fn(() => false);
vi.mock('../../preview/kinds', () => ({
  canPreviewDocument: (...a) => canPreviewDocument(...a),
}));

import { WorkingFolderLive } from './WorkingFolderLive';
import { fetchArtifacts } from '../../api';
import { setOrgMode } from '../../../lib/orgMode';
import { NO_PREVIEW_DOWNLOADED_NOTE } from '../../lib/artifactActions';

const PROJECT = { id: 'proj-1', name: 'general', path: '/proj' };
const SHARED_URL = 'https://view.mindshub.ai/r/abc';

// The shared menu mounts its popup after the click settles, so wait for it
// before reading its items.
const openKebab = async (row = 0) => {
  fireEvent.click(screen.getAllByLabelText('More actions')[row]);
  return screen.findByRole('menu');
};

const draft = (overrides = {}) => ({
  id: '11111111111111111111111111111111',
  title: 'Weekly Report',
  path: '/proj/.anton/artifacts/weekly/report.md',
  ext: '.md',
  type: 'report',
  mtime: 2000,
  updated: '3h ago',
  draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.md',
  publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
  ...overrides,
});

const renderRail = async (artifact) => {
  fetchArtifacts.mockResolvedValue([artifact]);
  render(<WorkingFolderLive project={PROJECT} isStreaming={false} />);
  return screen.findByText(/Weekly Report|Ops Console/);
};

beforeEach(() => {
  openExternal.mockClear();
  openPath.mockClear();
  downloadArtifactFile.mockClear();
  downloadArtifactFile.mockImplementation(async () => true);
  hostState.isWeb = true; hostState.isElectron = false; hostState.localApi = false;
  canPreviewDocument.mockReset();
  canPreviewDocument.mockReturnValue(false);
});
afterEach(() => setOrgMode(false));

describe('artifacts rail click in org mode', () => {
  beforeEach(() => setOrgMode(true));

  it('previews the authenticated draft instead of opening a tab', async () => {
    const row = await renderRail(draft());

    fireEvent.click(row);

    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent('Weekly Report');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('previews it even once the artifact is shared', async () => {
    /*
     * The whole defect: the shared page won the click, so the user was thrown
     * out of the app to read their own artifact.
     */
    const row = await renderRail(draft({ publishedUrl: SHARED_URL }));

    fireEvent.click(row);

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('falls back to the shared page for a draft it cannot render', async () => {
    const row = await renderRail(draft({
      title: 'Ops Console',
      type: 'fullstack-stateless-app',
      path: '/proj/.anton/artifacts/ops/static/index.html',
      ext: '.html',
      publishedUrl: SHARED_URL,
    }));

    fireEvent.click(row);

    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    expect(openExternal).toHaveBeenCalledWith(SHARED_URL);
  });

  it('does not fall back to window.open when the bridge rejects', async () => {
    /*
     * host.openExternal is what restricts the agent-writable URL to safe
     * schemes, so a rejection is caught (awaited, not left unhandled) and the
     * raw URL never reaches window.open.
     */
    openExternal.mockRejectedValueOnce(new Error('bridge gone'));
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const row = await renderRail(draft({
        title: 'Ops Console',
        type: 'fullstack-stateless-app',
        path: '/proj/.anton/artifacts/ops/static/index.html',
        ext: '.html',
        publishedUrl: SHARED_URL,
      }));

      fireEvent.click(row);
      await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(SHARED_URL));
      expect(opened).not.toHaveBeenCalled();
    } finally {
      opened.mockRestore();
    }
  });

  it('never hands the path to the OS, which org mode cannot reach', async () => {
    const row = await renderRail(draft({
      ext: '.zip',
      path: '/proj/.anton/artifacts/weekly/report.zip',
      draftUrl: '',
    }));

    fireEvent.click(row);

    expect(openPath).not.toHaveBeenCalled();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    // No draft URL either: genuinely nothing to save (ENG-2044 keeps this dead end).
    expect(downloadArtifactFile).not.toHaveBeenCalled();
  });

  it('saves a draft the viewer cannot render instead of dying (ENG-2044)', async () => {
    /*
     * The case that shipped broken: no preview, nothing shared, no serve URL —
     * but the draft URL streams the bytes. The rail used to print "This
     * artifact has no servable file yet." for a file on disk. It now says why
     * the click downloaded once the save went through.
     */
    const row = await renderRail(draft({
      ext: '.zip',
      path: '/proj/.anton/artifacts/weekly/report.zip',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.zip',
    }));

    fireEvent.click(row);

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(screen.queryByText('This artifact has no servable file yet.')).toBeNull();
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeInTheDocument();
  });

  it('keeps the honest dead end for an unshared fullstack app rather than saving its shell', async () => {
    /*
     * Self-review finding on ENG-2044: a fullstack app's draft URL points at
     * `static/index.html`, which is not the app. Offering "Download" there would
     * hand the user a useless file with a confident label. Autopublish publishes
     * these on the next turn; until then the existing message is the truth.
     */
    const row = await renderRail(draft({
      title: 'Ops Console',
      type: 'fullstack-stateless-app',
      path: '/proj/.anton/artifacts/ops/static/index.html',
      ext: '.html',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/static/index.html',
      publishedUrl: '',
    }));

    fireEvent.click(row);

    expect(downloadArtifactFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('keeps the kebab honest for a PUBLISHED fullstack app: open, never Download', async () => {
    /*
     * Review finding on #764: `canDownload` had no test — forcing it true left
     * the whole suite green. This is the state that catches it: publishedUrl
     * makes canOpenRemote true, and the backend type makes canDownloadOrgDraft
     * false, so a regression to !!draftUrl renders a Download row that would
     * save the app's shell index.html.
     */
    await renderRail(draft({
      title: 'Ops Console',
      type: 'fullstack-stateless-app',
      path: '/proj/.anton/artifacts/ops/static/index.html',
      ext: '.html',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/static/index.html',
      publishedUrl: SHARED_URL,
    }));

    await openKebab();

    expect(screen.getByText('Open in new tab')).toBeInTheDocument();
    expect(screen.queryByText('Download')).toBeNull();
  });

  it('uses the shared menu, which grows from the kebab, and keeps its clicks off the row', async () => {
    const row = await renderRail(draft({ title: 'Ops Console' }));
    fireEvent.click(row);
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    cleanup();

    await renderRail(draft({ title: 'Ops Console' }));
    expect((await openKebab()).className).toContain('[transform-origin:var(--transform-origin)]');

    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete "Ops Console"?')).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('does not label the dead end Download for an unshared fullstack app', async () => {
    // Same review pass: openLabel keyed off canOpenRemote alone, so the two
    // states where nothing can be saved read "Download" and then printed the
    // dead-end message. The label must not promise what the click cannot do.
    await renderRail(draft({
      title: 'Ops Console',
      type: 'fullstack-stateless-app',
      path: '/proj/.anton/artifacts/ops/static/index.html',
      ext: '.html',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/static/index.html',
      publishedUrl: '',
    }));

    await openKebab();

    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.getByText('Open in new tab')).toBeInTheDocument();
  });

  it('shows the dead-end message when the download itself fails', async () => {
    // Review pass 2: the transport can reject — expired bearer, offline, a
    // file deleted server-side. `downloadArtifactFile` resolves false then,
    // and the row must say so rather than end the click in silence.
    downloadArtifactFile.mockImplementationOnce(async () => false);
    const row = await renderRail(draft({
      ext: '.zip',
      path: '/proj/.anton/artifacts/weekly/report.zip',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.zip',
    }));

    fireEvent.click(row);

    expect(await screen.findByText('This artifact has no servable file yet.')).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
  });

  it('labels the menu action Download when a tab has nowhere to open', async () => {
    /*
     * "Open in new tab" with no serve URL and no shared page was the item that
     * produced the dead-end message. With only a draft URL the same item now
     * says what it will do, and does it.
     */
    await renderRail(draft({
      ext: '.zip',
      path: '/proj/.anton/artifacts/weekly/report.zip',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.zip',
    }));

    await openKebab();
    fireEvent.click(screen.getByText('Download'));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Open in new tab')).toBeNull();
  });

  it('shows the dead-end message when the menu Download itself fails', async () => {
    /*
     * openArtifactExternal is a DIFFERENT call site from the row click —
     * mutation testing on pass 2 showed stripping ITS await left the suite
     * green while the row-click guard passed. One failure case per site.
     */
    downloadArtifactFile.mockImplementationOnce(async () => false);
    await renderRail(draft({
      ext: '.zip',
      path: '/proj/.anton/artifacts/weekly/report.zip',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.zip',
    }));

    await openKebab();
    fireEvent.click(screen.getByText('Download'));

    expect(await screen.findByText('This artifact has no servable file yet.')).toBeInTheDocument();
  });

  it('the standalone Download item reports a failed download too', async () => {
    // Third call site: the separate Download row that renders when Open goes
    // to a tab (shared page) but the file itself is still worth saving.
    downloadArtifactFile.mockImplementationOnce(async () => false);
    await renderRail(draft({ publishedUrl: SHARED_URL }));

    await openKebab();
    expect(screen.getByText('Open in new tab')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Download'));

    expect(await screen.findByText('This artifact has no servable file yet.')).toBeInTheDocument();
  });
});

describe('artifacts rail kebab on a non-org web deployment', () => {
  it('does not offer Download for a fullstack app that has a serve URL', async () => {
    /*
     * Review pass 2: `a.serveUrl ||` short-circuited ahead of
     * canDownloadOrgDraft, so the fullstack-shell exclusion leaked on exactly
     * this deployment (dev:web, self-hosted, the enterprise container):
     * serve_url_for is only blanked in org mode, and the app's primary is its
     * shell static/index.html — saving it reads as the app and is not.
     */
    await renderRail(draft({
      title: 'Ops Console',
      type: 'fullstack-stateless-app',
      path: '/proj/.anton/artifacts/ops/static/index.html',
      ext: '.html',
      serveUrl: '/v1/artifacts/serve/ops/static/index.html',
      draftUrl: '',
      publishedUrl: '',
    }));

    await openKebab();

    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.getByText('Open in new tab')).toBeInTheDocument();
  });
});

describe('artifacts rail click on desktop', () => {
  /*
   * The org branch must not narrow desktop: a text artifact still previews
   * from local bytes, with or without a draft URL.
   */
  beforeEach(() => setOrgMode(false));

  it('still previews a text artifact locally', async () => {
    const row = await renderRail(draft({ draftUrl: '' }));

    fireEvent.click(row);

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

// ENG-2979: another member's artifact gets a person icon right after the
// type icon. The column is reserved on every row of a list that has at least
// one marker, so names stay in one column; an owner-only list is unchanged.
describe('artifacts rail authorship marker', () => {
  beforeEach(() => setOrgMode(true));

  const FOUR = 'grid-cols-[14px_12px_minmax(0,1fr)_auto]';
  const THREE = 'grid-cols-[14px_minmax(0,1fr)_auto]';
  const other = (overrides = {}) => draft({
    id: '22222222222222222222222222222222',
    title: 'Ops Console',
    path: '/proj/.anton/artifacts/ops/console.md',
    capabilities: { role: 'reviewer', canEdit: false },
    ...overrides,
  });
  const renderRows = async (list) => {
    fetchArtifacts.mockResolvedValue(list);
    render(<WorkingFolderLive project={PROJECT} isStreaming={false} />);
    await screen.findByText(list[0].title);
  };
  const rowOf = (title) => screen.getByText(title).closest('[role="button"]');

  it('marks another member\'s row with a labelled icon', async () => {
    await renderRows([other()]);
    expect(screen.getByRole('img', { name: 'Another member' })).toBeInTheDocument();
    expect(rowOf('Ops Console').getAttribute('title')).toContain(' · Another member');
    expect(rowOf('Ops Console').className).toContain(FOUR);
  });

  it('marks an ownerless row', async () => {
    await renderRows([other({ capabilities: { role: 'reviewer', canEdit: false, ownerUnknown: true } })]);
    expect(screen.getByRole('img', { name: 'Unknown owner' })).toBeInTheDocument();
    expect(rowOf('Ops Console').getAttribute('title')).toContain(' · Unknown owner');
  });

  it('leaves an owner-only list exactly as it was', async () => {
    await renderRows([draft()]);
    expect(screen.queryByRole('img', { name: /Another member|Unknown owner/ })).toBeNull();
    expect(rowOf('Weekly Report').className).toContain(THREE);
    expect(rowOf('Weekly Report').getAttribute('title')).not.toContain('Another member');
  });

  it('aligns names in a mixed list', async () => {
    await renderRows([other(), draft()]);
    expect(rowOf('Ops Console').className).toContain(FOUR);
    expect(rowOf('Weekly Report').className).toContain(FOUR);
    expect(screen.getAllByRole('img', { name: 'Another member' })).toHaveLength(1);
    // The owner row keeps the column with an empty, hidden cell.
    expect(rowOf('Weekly Report').children[1].getAttribute('aria-hidden')).toBe('true');
  });

  // ENG-2979 fix wave (code review): recomputing the column from the raw
  // top-12 slice on every 3s poll made it — and every row's horizontal
  // position — jump as a colleague's artifact entered/left the slice.
  it('keeps the marker column once set, even when a later poll comes back owner-only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchArtifacts.mockResolvedValueOnce([other()]);
      const { rerender } = render(<WorkingFolderLive project={PROJECT} isStreaming={false} />);
      await screen.findByText('Ops Console');
      expect(rowOf('Ops Console').className).toContain(FOUR);

      // Simulate the "streaming just ended" poll: it fires once, ~1s after
      // isStreaming flips back to false, and this time the slice is owner-only.
      fetchArtifacts.mockResolvedValueOnce([draft()]);
      rerender(<WorkingFolderLive project={PROJECT} isStreaming />);
      rerender(<WorkingFolderLive project={PROJECT} isStreaming={false} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await screen.findByText('Weekly Report');

      expect(screen.queryByText('Ops Console')).toBeNull();
      // Column stays reserved for this project even though nothing in the
      // current slice needs it any more.
      expect(rowOf('Weekly Report').className).toContain(FOUR);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the marker column to three when the project changes', async () => {
    const OTHER_PROJECT = { id: 'proj-2', name: 'other', path: '/proj2' };
    fetchArtifacts.mockResolvedValueOnce([other()]);
    const { rerender } = render(<WorkingFolderLive project={PROJECT} isStreaming={false} />);
    await screen.findByText('Ops Console');
    expect(rowOf('Ops Console').className).toContain(FOUR);

    fetchArtifacts.mockResolvedValueOnce([draft()]);
    rerender(<WorkingFolderLive project={OTHER_PROJECT} isStreaming={false} />);
    await screen.findByText('Weekly Report');

    expect(rowOf('Weekly Report').className).toContain(THREE);
  });
});

describe('artifacts rail grouping by conversation', () => {
  const CHAT = 'conv-1';
  const art = (title, originConversationId, i = 0) => draft({
    id: `${i}`.padStart(32, '0'),
    title,
    path: `/proj/.anton/artifacts/${title.replace(/\s+/g, '-')}/report.md`,
    originConversationId,
  });
  // Artifact rows are the role="button" divs whose native title is the path;
  // the name is the row's `.truncate` span.
  const titles = () => screen.getAllByRole('button')
    .filter((el) => el.getAttribute('title')?.startsWith('/proj/'))
    .map((el) => el.querySelector('.truncate').textContent);
  const renderList = async (list, conversationId = CHAT) => {
    fetchArtifacts.mockResolvedValue(list);
    const utils = render(
      <WorkingFolderLive project={PROJECT} isStreaming={false} conversationId={conversationId} />,
    );
    await screen.findByText(list[0].title);
    return utils;
  };

  it('lists this chat\'s artifacts first, separated from the rest of the project', async () => {
    await renderList([
      art('Other A', 'conv-2', 1),
      art('Mine A', CHAT, 2),
      art('Legacy', '', 3),
      art('Mine B', CHAT, 4),
    ]);

    expect(titles()).toEqual(['Mine A', 'Mine B', 'Other A', 'Legacy']);
    const separator = screen.getByRole('separator');
    expect(separator.previousElementSibling).toHaveTextContent('Mine B');
    expect(separator.nextElementSibling).toHaveTextContent('Other A');
    expect(separator).toHaveAttribute('aria-label', 'Other artifacts in this project');
  });

  it('draws no separator when only one group has rows', async () => {
    await renderList([art('Mine A', CHAT, 1)]);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('draws no separator when no row is from this chat', async () => {
    await renderList([art('Other A', 'conv-2', 1), art('Other B', '', 2)]);
    expect(titles()).toEqual(['Other A', 'Other B']);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('draws no separator and keeps server order outside a chat', async () => {
    await renderList([art('Other A', 'conv-2', 1), art('Mine A', CHAT, 2)], null);
    expect(titles()).toEqual(['Other A', 'Mine A']);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('keeps an older artifact of this chat that the 12 newest others would push out', async () => {
    const others = Array.from({ length: 12 }, (_, i) => art(`Other ${i}`, 'conv-2', i + 1));
    await renderList([...others, art('Mine Old', CHAT, 99)]);
    expect(titles()[0]).toBe('Mine Old');
    expect(titles()).toHaveLength(13);
  });

  it('regroups on a chat switch within the project without refetching', async () => {
    const { rerender } = await renderList([art('Other A', 'conv-2', 1), art('Mine A', CHAT, 2)]);
    expect(titles()).toEqual(['Mine A', 'Other A']);
    const calls = fetchArtifacts.mock.calls.length;

    rerender(<WorkingFolderLive project={PROJECT} isStreaming={false} conversationId="conv-2" />);

    expect(titles()).toEqual(['Other A', 'Mine A']);
    expect(fetchArtifacts.mock.calls.length).toBe(calls);
  });

  it('keeps an open row menu on its artifact when the chat regroups the rows', async () => {
    const { rerender } = await renderList([art('Other A', 'conv-2', 1), art('Mine A', CHAT, 2)]);
    await openKebab(1);

    rerender(<WorkingFolderLive project={PROJECT} isStreaming={false} conversationId="conv-2" />);

    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete "Other A"?')).toBeInTheDocument();
  });

  it('closes an open row menu once its row leaves the list', async () => {
    const { rerender } = await renderList([art('Other A', 'conv-2', 1)]);
    await openKebab();
    expect(screen.getByText('Delete')).toBeInTheDocument();

    fetchArtifacts.mockResolvedValue([]);
    rerender(<WorkingFolderLive project={{ id: 'proj-2', name: 'other', path: '/proj2' }} isStreaming={false} conversationId={CHAT} />);

    expect(screen.queryByText('Delete')).toBeNull();

    fetchArtifacts.mockResolvedValue([art('Other A', 'conv-2', 1)]);
    rerender(<WorkingFolderLive project={PROJECT} isStreaming={false} conversationId={CHAT} />);
    await screen.findByText('Other A');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Moving to a chat of another project changes `project` and `conversationId`
  // in one commit. The rows effect then still sees the old project's rows, so
  // the project-switch effect must run after it and win.
  it('resets the marker column when switching to a chat of another project', async () => {
    const FOUR = 'grid-cols-[14px_12px_minmax(0,1fr)_auto]';
    const THREE = 'grid-cols-[14px_minmax(0,1fr)_auto]';
    const OTHER_PROJECT = { id: 'proj-2', name: 'other', path: '/proj2' };
    const colleague = art('Colleague', 'conv-9', 1);
    colleague.capabilities = { role: 'reviewer', canEdit: false };
    const { rerender } = await renderList([colleague]);
    expect(screen.getByText('Colleague').closest('[role="button"]').className).toContain(FOUR);

    const mine = draft({ title: 'Mine B', path: '/proj2/.anton/artifacts/mine-b/report.md', originConversationId: 'conv-2' });
    fetchArtifacts.mockResolvedValue([mine]);
    rerender(<WorkingFolderLive project={OTHER_PROJECT} isStreaming={false} conversationId="conv-2" />);
    await screen.findByText('Mine B');

    expect(screen.getByText('Mine B').closest('[role="button"]').className).toContain(THREE);
  });
});

/*
 * A file with no preview, clicked in the rail on a web host: it downloads once,
 * and the rail says why in a neutral line only after the download went
 * through. Every extension and surface comes from artifactSurfaces.yaml.
 */
const fileRow = (ext, overrides = {}) => draft({
  ext,
  type: 'file',
  path: `/proj/.anton/artifacts/data/data${ext}`,
  draftUrl: `/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/data${ext}`,
  ...overrides,
});
const clickRail = {
  row: (row) => fireEvent.click(row),
};
const railNote = () => screen.getByRole('status');

describe.each(FIXTURES.webModes)('artifacts rail on %s', (mode) => {
  beforeEach(() => setOrgMode(mode === 'org web'));

  describe.each(FIXTURES.clickSurfaces.artifactsBox)('a %s click on a file with no preview', (surface) => {
    it.each(FIXTURES.noPreviewExtensions)('downloads %s once, then shows the note', async (ext) => {
      const row = await renderRail(fileRow(ext));

      clickRail[surface](row);

      await vi.waitFor(() => expect(railNote()).toHaveTextContent(NO_PREVIEW_DOWNLOADED_NOTE));
      expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
      expect(downloadArtifactFile.mock.calls[0][0]).toMatchObject({ draftUrl: expect.stringContaining(`data${ext}`) });
      expect(screen.queryByTestId('artifact-viewer')).toBeNull();
      expect(openExternal).not.toHaveBeenCalled();
    });
  });

  it('shows the error and no note when the download fails', async () => {
    downloadArtifactFile.mockImplementationOnce(async () => false);
    const row = await renderRail(fileRow('.zip'));

    fireEvent.click(row);

    expect(await screen.findByText('This artifact has no servable file yet.')).toBeInTheDocument();
    expect(railNote().textContent).toBe('');
  });

  it.each(FIXTURES.documentPreviewExtensions)('previews %s first when the document gate allows it', async (ext) => {
    canPreviewDocument.mockReturnValue(true);
    const row = await renderRail(fileRow(ext));

    fireEvent.click(row);
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(downloadArtifactFile).not.toHaveBeenCalled();

    const items = within(await openKebab()).getAllByRole('menuitem').map((el) => el.textContent);
    expect(items[0]).toBe('Preview');
    expect(items).toContain('Download');
  });

  it.each(FIXTURES.documentPreviewExtensions)('downloads %s with the note when the document gate refuses it', async (ext) => {
    const row = await renderRail(fileRow(ext));

    fireEvent.click(row);

    await vi.waitFor(() => expect(railNote()).toHaveTextContent(NO_PREVIEW_DOWNLOADED_NOTE));
    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });
});

describe('artifacts rail tab on local web', () => {
  /* A tab opened on a file a browser cannot show saves it without a word, so
     the rail offers a tab only for what a tab renders. */
  beforeEach(() => setOrgMode(false));
  const SERVE = (ext) => `/v1/artifacts/serve/data/data${ext}`;

  it.each(FIXTURES.browserTab.withheld)('offers Download and no tab for %s', async (ext) => {
    await renderRail(fileRow(ext, { serveUrl: SERVE(ext) }));

    await openKebab();

    expect(screen.queryByText('Open in new tab')).toBeNull();
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it.each(FIXTURES.browserTab.opens)('keeps the tab for %s', async (ext) => {
    await renderRail(fileRow(ext, { serveUrl: SERVE(ext) }));

    await openKebab();
    fireEvent.click(screen.getByText('Open in new tab'));

    expect(openExternal).toHaveBeenCalledWith(`https://cowork.example${SERVE(ext)}`);
  });

  it('saves from the Download item through the download helper, never a tab', async () => {
    await renderRail(fileRow('.xlsx', { serveUrl: SERVE('.xlsx') }));

    await openKebab();
    fireEvent.click(screen.getByText('Download'));

    await vi.waitFor(() => expect(downloadArtifactFile).toHaveBeenCalledTimes(1));
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('artifacts rail on desktop', () => {
  beforeEach(() => {
    setOrgMode(false);
    hostState.isWeb = false; hostState.isElectron = true; hostState.localApi = true;
    openPath.mockResolvedValue({ ok: true });
  });

  it.each(FIXTURES.documentPreviewExtensions)('opens %s in the default app when the document gate refuses it', async (ext) => {
    const row = await renderRail(fileRow(ext));

    fireEvent.click(row);

    expect(openPath).toHaveBeenCalledWith(`/proj/.anton/artifacts/data/data${ext}`);
    expect(downloadArtifactFile).not.toHaveBeenCalled();
  });

  it.each(FIXTURES.documentPreviewExtensions)('previews %s when the document gate allows it', async (ext) => {
    canPreviewDocument.mockReturnValue(true);
    const row = await renderRail(fileRow(ext));

    fireEvent.click(row);

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(openPath).not.toHaveBeenCalled();
  });

  it.each(FIXTURES.documentPreviewExtensions)('lists Preview, then Open in OS, for %s when the document gate allows it', async (ext) => {
    canPreviewDocument.mockReturnValue(true);
    await renderRail(fileRow(ext, { serveUrl: `/v1/artifacts/serve/data/data${ext}` }));

    const menu = await openKebab();
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Preview', 'Open in OS', 'Delete']);
    fireEvent.click(within(menu).getByText('Open in OS'));

    await vi.waitFor(() => expect(openPath).toHaveBeenCalledWith(`/proj/.anton/artifacts/data/data${ext}`));
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('keeps Open in OS in the menu, with no tab', async () => {
    await renderRail(fileRow('.zip', { serveUrl: '/v1/artifacts/serve/data/data.zip' }));

    await openKebab();

    expect(screen.getByText('Open in OS')).toBeInTheDocument();
    expect(screen.queryByText('Open in new tab')).toBeNull();
    expect(screen.queryByText('Download')).toBeNull();
  });
});
