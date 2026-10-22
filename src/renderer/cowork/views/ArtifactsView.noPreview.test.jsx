/*
 * The Live Artifacts page's click rules on each host. A file with no preview
 * downloads and then says why. A document type follows the shared preview
 * gate. ↗ opens a tab only for what a tab shows, and desktop keeps the shared
 * page ahead of the default app. Extensions, surfaces and modes come from
 * ../lib/artifactSurfaces.yaml.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const FIXTURES = load(readFileSync(resolve(import.meta.dirname, '../lib/artifactSurfaces.yaml'), 'utf-8'));

const mocks = vi.hoisted(() => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn(async () => {}) },
  openArtifactFile: vi.fn(),
  downloadArtifactFile: vi.fn(async () => true),
  canPreviewDocument: vi.fn(() => false),
  toastAdd: vi.fn(),
}));

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: (a) => (a?.serveUrl ? `https://cowork.example${a.serveUrl}` : ''),
  openArtifactFile: (...a) => mocks.openArtifactFile(...a),
}));
vi.mock('../../platform/host', () => ({ host: mocks.host }));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: mocks.toastAdd }) }));
vi.mock('../lib/artifactDownload', () => ({
  downloadArtifactFile: (...a) => mocks.downloadArtifactFile(...a),
}));
vi.mock('../preview/kinds', () => ({
  canPreviewDocument: (...a) => mocks.canPreviewDocument(...a),
}));
vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact }) => (open ? <div data-testid="artifact-viewer">{artifact.title}</div> : null),
}));

import ArtifactsView from './ArtifactsView';
import { NO_PREVIEW_DOWNLOADED_NOTE } from '../lib/artifactActions';
import { setOrgMode } from '../../lib/orgMode';

const VIEW_OF = { 'grid card': 'grid', 'list row': 'list' };
const TITLE = 'Quarterly Data';
const SHARED_URL = 'https://view.example/r/abc';
const ID = '55555555555555555555555555555555';

/* A card as each host lists it: an org deployment sends no serve URL. */
const card = (ext, mode, overrides = {}) => ({
  id: ID,
  path: `/proj/.anton/artifacts/data/data${ext}`,
  title: TITLE,
  type: 'file',
  ext,
  mtime: 2000,
  draftUrl: `/api/v1/artifacts/drafts/proj-1/${ID}/data${ext}`,
  serveUrl: mode === 'org web' ? '' : `/v1/artifacts/serve/data/data${ext}`,
  publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
  ...overrides,
});

function enter(mode) {
  setOrgMode(mode === 'org web');
  mocks.host.isWeb = mode !== 'desktop';
  mocks.host.isElectron = mode === 'desktop';
}

function renderView(surface, artifact) {
  localStorage.setItem('anton:artifacts-view', VIEW_OF[surface]);
  return render(<ArtifactsView artifacts={[artifact]} />);
}

const clickBody = () => fireEvent.click(screen.getByText(TITLE));
const openKebab = () => fireEvent.click(screen.getByLabelText('Artifact menu'));
const menuLabels = () => screen.getAllByRole('menuitem').map((el) => el.textContent);
const noteShown = () => mocks.toastAdd.mock.calls.some(([toast]) => toast?.title === NO_PREVIEW_DOWNLOADED_NOTE);

beforeEach(() => {
  mocks.host.openExternal.mockClear();
  mocks.openArtifactFile.mockClear();
  mocks.downloadArtifactFile.mockReset();
  mocks.downloadArtifactFile.mockImplementation(async () => true);
  mocks.canPreviewDocument.mockReset();
  mocks.canPreviewDocument.mockReturnValue(false);
  mocks.toastAdd.mockClear();
});

afterEach(() => {
  localStorage.clear();
  enter('local web');
});

describe.each(FIXTURES.webModes)('Live Artifacts on %s', (mode) => {
  beforeEach(() => enter(mode));

  describe.each(FIXTURES.clickSurfaces.liveArtifacts)('a %s click', (surface) => {
    it.each(FIXTURES.noPreviewExtensions)('downloads %s once, then shows the note', async (ext) => {
      renderView(surface, card(ext, mode));

      clickBody();

      await vi.waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledWith({ title: NO_PREVIEW_DOWNLOADED_NOTE }));
      expect(mocks.downloadArtifactFile).toHaveBeenCalledTimes(1);
      expect(mocks.downloadArtifactFile.mock.calls[0][0]).toMatchObject({ path: `/proj/.anton/artifacts/data/data${ext}` });
      expect(screen.queryByTestId('artifact-viewer')).toBeNull();
      expect(mocks.host.openExternal).not.toHaveBeenCalled();
    });

    it('shows the error and no note when the download fails', async () => {
      mocks.downloadArtifactFile.mockImplementationOnce(async () => false);
      renderView(surface, card('.zip', mode));

      clickBody();

      await vi.waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not download this artifact.', type: 'danger' }),
      ));
      expect(noteShown()).toBe(false);
    });

    it.each(FIXTURES.documentPreviewExtensions)('previews %s when the document gate allows it', (ext) => {
      mocks.canPreviewDocument.mockReturnValue(true);
      renderView(surface, card(ext, mode));

      clickBody();

      expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
      expect(mocks.downloadArtifactFile).not.toHaveBeenCalled();
    });

    it.each(FIXTURES.documentPreviewExtensions)('offers Download beside the preview of %s in the menu', (ext) => {
      mocks.canPreviewDocument.mockReturnValue(true);
      renderView(surface, card(ext, mode));

      openKebab();
      expect(menuLabels()).toContain('Download');
      fireEvent.click(screen.getByRole('menuitem', { name: FIXTURES.liveArtifactsPreviewItem[surface][mode] }));

      expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
      expect(mocks.downloadArtifactFile).not.toHaveBeenCalled();
    });

    it.each(FIXTURES.documentPreviewExtensions)('downloads %s with the note when the document gate refuses it', async (ext) => {
      renderView(surface, card(ext, mode));

      clickBody();

      await vi.waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledWith({ title: NO_PREVIEW_DOWNLOADED_NOTE }));
      expect(mocks.downloadArtifactFile).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    });

    /* The click already downloads these, so the menu has no Open item that
       would do the same. */
    it.each(FIXTURES.noPreviewExtensions)('offers Download and no Open item for %s in the menu', (ext) => {
      renderView(surface, card(ext, mode));

      openKebab();

      expect(menuLabels()).toContain('Download');
      expect(menuLabels()).not.toContain('Open');
    });

    it.each(FIXTURES.browserTab.withheld)('shows no ↗ for %s', (ext) => {
      renderView(surface, card(ext, mode));
      expect(screen.queryByLabelText('Open')).toBeNull();
    });

    it.each(FIXTURES.browserTab.opens)('shows ↗ for %s', (ext) => {
      renderView(surface, card(ext, mode));
      expect(screen.getByLabelText('Open')).toBeInTheDocument();
    });
  });
});

describe.each(FIXTURES.clickSurfaces.liveArtifacts)('Live Artifacts %s on local web', (surface) => {
  beforeEach(() => enter('local web'));

  it('opens the viewer from the body and a tab from its own ↗', () => {
    renderView(surface, card('.html', 'local web'));

    fireEvent.click(screen.getByLabelText('Open'));
    expect(mocks.host.openExternal).toHaveBeenCalledWith('https://cowork.example/v1/artifacts/serve/data/data.html');
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();

    clickBody();
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
  });

  it('offers no Download and no note for a card with no URL', () => {
    renderView(surface, card('.zip', 'local web', { draftUrl: '', serveUrl: '' }));

    clickBody();
    openKebab();

    expect(mocks.downloadArtifactFile).not.toHaveBeenCalled();
    expect(screen.queryByText('Download')).toBeNull();
    expect(noteShown()).toBe(false);
  });
});

describe.each(FIXTURES.clickSurfaces.liveArtifacts)('Live Artifacts %s on desktop', (surface) => {
  beforeEach(() => enter('desktop'));

  it.each(FIXTURES.documentPreviewExtensions)('opens %s in the default app when the document gate refuses it', (ext) => {
    const artifact = card(ext, 'desktop');
    renderView(surface, artifact);

    clickBody();

    expect(mocks.openArtifactFile).toHaveBeenCalledWith(artifact);
    expect(mocks.downloadArtifactFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it.each(FIXTURES.documentPreviewExtensions)('previews %s when the document gate allows it, and ↗ opens the default app', (ext) => {
    mocks.canPreviewDocument.mockReturnValue(true);
    const artifact = card(ext, 'desktop');
    renderView(surface, artifact);

    fireEvent.click(screen.getByLabelText('Open'));
    expect(mocks.openArtifactFile).toHaveBeenCalledWith(artifact);
    expect(mocks.host.openExternal).not.toHaveBeenCalled();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();

    clickBody();

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(mocks.openArtifactFile).toHaveBeenCalledTimes(1);
  });

  it('tries the shared page before the default app', () => {
    renderView(surface, card('.zip', 'desktop', { publishedUrl: SHARED_URL }));

    clickBody();

    expect(mocks.host.openExternal).toHaveBeenCalledWith(SHARED_URL);
    expect(mocks.openArtifactFile).not.toHaveBeenCalled();
  });

  it('keeps ↗ for a file a web tab would save', () => {
    renderView(surface, card('.xlsx', 'desktop'));
    expect(screen.getByLabelText('Open')).toBeInTheDocument();
  });
});
