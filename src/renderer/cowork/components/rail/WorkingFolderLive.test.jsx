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
import { render, screen, fireEvent } from '@testing-library/react';

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

import { WorkingFolderLive } from './WorkingFolderLive';
import { fetchArtifacts } from '../../api';
import { setOrgMode } from '../../../lib/orgMode';

const PROJECT = { id: 'proj-1', name: 'general', path: '/proj' };
const SHARED_URL = 'https://view.mindshub.ai/r/abc';

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

  it('falls back to window.open when the bridge rejects', async () => {
    /*
     * host.openExternal is async, so only an awaited call lets the catch see a
     * rejection. Unawaited, the fallback is unreachable and the rejection is
     * never handled.
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
      await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(
        SHARED_URL, '_blank', 'noopener,noreferrer',
      ));
    } finally {
      opened.mockRestore();
    }
  });

  it('never hands the path to the OS, which org mode cannot reach', async () => {
    const row = await renderRail(draft({
      ext: '.docx',
      path: '/proj/.anton/artifacts/weekly/report.docx',
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
     * The .docx / .xlsx case that shipped broken: no preview, nothing shared,
     * no serve URL — but the draft URL streams the bytes. The rail used to
     * print "This artifact has no servable file yet." for a file on disk.
     */
    const row = await renderRail(draft({
      ext: '.docx',
      path: '/proj/.anton/artifacts/weekly/report.docx',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.docx',
    }));

    fireEvent.click(row);

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(screen.queryByText('This artifact has no servable file yet.')).toBeNull();
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

    fireEvent.click(screen.getByLabelText('More actions'));

    expect(screen.getByText('Open in new tab')).toBeInTheDocument();
    expect(screen.queryByText('Download')).toBeNull();
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

    fireEvent.click(screen.getByLabelText('More actions'));

    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.getByText('Open in new tab')).toBeInTheDocument();
  });

  it('shows the dead-end message when the download itself fails', async () => {
    // Review pass 2: the transport can reject — expired bearer, offline, a
    // file deleted server-side. `downloadArtifactFile` resolves false then,
    // and the row must say so rather than end the click in silence.
    downloadArtifactFile.mockImplementationOnce(async () => false);
    const row = await renderRail(draft({
      ext: '.docx',
      path: '/proj/.anton/artifacts/weekly/report.docx',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.docx',
    }));

    fireEvent.click(row);

    expect(await screen.findByText('This artifact has no servable file yet.')).toBeInTheDocument();
  });

  it('labels the menu action Download when a tab has nowhere to open', async () => {
    /*
     * "Open in new tab" with no serve URL and no shared page was the item that
     * produced the dead-end message. With only a draft URL the same item now
     * says what it will do, and does it.
     */
    await renderRail(draft({
      ext: '.docx',
      path: '/proj/.anton/artifacts/weekly/report.docx',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.docx',
    }));

    fireEvent.click(screen.getByLabelText('More actions'));
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
      ext: '.docx',
      path: '/proj/.anton/artifacts/weekly/report.docx',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.docx',
    }));

    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Download'));

    expect(await screen.findByText('This artifact has no servable file yet.')).toBeInTheDocument();
  });

  it('the standalone Download item reports a failed download too', async () => {
    // Third call site: the separate Download row that renders when Open goes
    // to a tab (shared page) but the file itself is still worth saving.
    downloadArtifactFile.mockImplementationOnce(async () => false);
    await renderRail(draft({
      ext: '.docx',
      path: '/proj/.anton/artifacts/weekly/report.docx',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.docx',
      publishedUrl: SHARED_URL,
    }));

    fireEvent.click(screen.getByLabelText('More actions'));
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

    fireEvent.click(screen.getByLabelText('More actions'));

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
