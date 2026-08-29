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
const downloadArtifactFile = vi.fn(() => true);

vi.mock('../../api', () => ({
  fetchActiveProject: vi.fn(() => Promise.resolve(null)),
  fetchArtifacts: vi.fn(() => Promise.resolve([])),
  fetchProjects: vi.fn(() => Promise.resolve([])),
  unpublishArtifact: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isLocalApiOrigin: () => false,
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
