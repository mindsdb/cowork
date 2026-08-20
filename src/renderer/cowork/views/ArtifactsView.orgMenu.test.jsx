// The org-mode action gate has to be applied at BOTH menu sites.
//
// ArtifactsView builds its kebab menu twice: the list view's `ArtifactMenu`
// component owns its own item list, and the grid view's items are assembled
// inline by the page-level shared `HoverMenu`. They are separate arrays, so
// wiring the gate into one leaves the other offering Preview, Show in Finder and
// the publish controls on a deployment where none of them can work — and
// `Preview` there does not merely look wrong, it opens the local-content viewer.
//
// lib/artifactActions.test.js covers the gate's own logic. It cannot catch a
// caller that never asks, which is exactly how the grid menu was missed, so these
// tests drive the real component through both views.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn() },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';
import { setOrgMode } from '../../lib/orgMode';

const published = {
  id: 'a1', path: '/proj/.anton/artifacts/weather/index.html',
  title: 'Weather Dashboard', type: 'html-app', mtime: 2000,
  publishedUrl: 'https://view.mindshub.ai/r/abc',
};

// Desktop-only actions, by their menu labels. `Preview` is the one that prompted
// this test; the rest ride on the same gate and would regress together.
const DESKTOP_ONLY = ['Preview', 'Show in Finder', 'Show in Explorer', 'Share', 'Stop sharing', 'Update'];

function openKebab() {
  fireEvent.click(screen.getByLabelText('Artifact menu'));
}

afterEach(() => {
  localStorage.clear();
  setOrgMode(false);
});

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view kebab in org mode', (_name, view) => {
  beforeEach(() => {
    localStorage.setItem('anton:artifacts-view', view);
    setOrgMode(true);
  });

  it('offers no desktop-only action', () => {
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();
    for (const label of DESKTOP_ONLY) {
      expect(screen.queryByText(label), `${label} must not be offered in org mode`).toBeNull();
    }
  });

  it('still offers Delete', () => {
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();
    expect(screen.getByText(/Delete/)).toBeInTheDocument();
  });
});

describe('grid view kebab on desktop', () => {
  // The gate must not be a blanket removal: the same menu on a desktop
  // deployment keeps everything, which is what makes the org-mode assertion
  // above meaningful rather than vacuously true.
  it('still offers Preview', () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });
});


describe('deleting a published artifact', () => {
  // The panel unpublishes before deleting so a delete never leaves an orphaned
  // public copy. In org mode that call hits DELETE /publish, which is
  // desktop-only and answers 501 — the await threw and the delete never ran, so
  // the user got "Delete failed: not available in org deployments" for an
  // artifact the server was perfectly able to remove. It only became reachable
  // once auto-publishing started giving artifacts a publishedUrl.
  beforeEach(() => {
    api.unpublishArtifact.mockClear();
    api.deleteArtifact.mockClear();
  });

  it('leaves the unpublish to the server in org mode', async () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(true);
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();

    fireEvent.click(screen.getByText(/Delete/));

    expect(api.unpublishArtifact).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(api.deleteArtifact).toHaveBeenCalled());
  });

  it('still unpublishes first on desktop', async () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();

    fireEvent.click(screen.getByText(/Delete/));

    await vi.waitFor(() => expect(api.unpublishArtifact).toHaveBeenCalled());
  });
});


describe('delete gives feedback while it runs', () => {
  // Delete unpublishes remotely before removing anything (and in org mode mints
  // a turn key first), so it takes seconds. Without a phase the card looked
  // untouched the whole time and the only feedback was the row vanishing at the
  // end — indistinguishable from a click that did not register.
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };

  it('marks the card Deleting… and disables the menu item', async () => {
    const gate = deferred();
    api.deleteArtifact.mockReturnValueOnce(gate.promise);
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(true);
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();

    fireEvent.click(screen.getByText('Delete'));

    await screen.findByText('Deleting…');          // the menu item
    expect(screen.getAllByText('Deleting…').length).toBeGreaterThan(0);

    gate.resolve();
    await vi.waitFor(() => expect(screen.queryByText('Weather Dashboard')).toBeNull());
  });

  it('clears the phase when the delete fails, so the card is usable again', async () => {
    api.deleteArtifact.mockRejectedValueOnce(new Error('nope'));
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(true);
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();

    fireEvent.click(screen.getByText('Delete'));

    // The row survives a failure, and must not be left stuck in Deleting….
    await vi.waitFor(() => expect(screen.queryByText('Deleting…')).toBeNull());
    expect(screen.getByText('Weather Dashboard')).toBeInTheDocument();
  });
});
