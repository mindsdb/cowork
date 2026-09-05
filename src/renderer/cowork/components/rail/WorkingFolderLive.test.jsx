/*
 * Exercise actual rail clicks: merely asserting artifactOpenTarget is called cannot catch passing
 * it the wrong preview capability.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const openExternal = vi.fn();
const openPath = vi.fn();
// Keep the mock asynchronous; dropping await on a synchronous result would still pass, while
// Promise truthiness breaks failure handling.
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
    /* Prefer in-app draft preview over opening the artifact's shared page. */
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
    /* Await openExternal so its rejection reaches the fallback catch. */
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
     * Nonpreviewable, unpublished documents remain downloadable through their authenticated draft
     * URL.
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
     * A fullstack draft is only static/index.html, not the app; do not offer it as a complete
     * download.
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
     * Combine a published URL with fullstack type to distinguish remote opening from draft-download
     * eligibility.
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
    // The action label must not promise Download when the click has no downloadable target.
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
    // A resolved false download result must produce visible failure feedback.
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
    /* A draft-only external action must name and perform its download behavior. */
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
     * Test rejection at the separate external-menu call site too; row-click await coverage cannot
     * protect it.
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
    /* A serve URL on non-org web must not bypass the fullstack-shell download exclusion. */
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
  /* Org-mode restrictions must retain desktop text preview from local bytes. */
  beforeEach(() => setOrgMode(false));

  it('still previews a text artifact locally', async () => {
    const row = await renderRail(draft({ draftUrl: '' }));

    fireEvent.click(row);

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
