// The org-mode action gate has to be applied at BOTH menu sites.
//
// ArtifactsView builds its kebab menu twice: the list view's `ArtifactMenu`
// component owns its own item list, and the grid view's items are assembled
// inline by the page-level shared `HoverMenu`. They are separate arrays, so
// wiring the gate into one leaves the other offering filesystem and publish
// controls on a deployment where none of them can work. Preview is available
// only when an authenticated draft URL is present.
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
vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact }) => (open
    ? <div data-testid="artifact-viewer">Private preview: {artifact.title}</div>
    : null),
}));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';
import { host } from '../../platform/host';
import { setOrgMode } from '../../lib/orgMode';

const published = {
  id: 'a1', path: '/proj/.anton/artifacts/weather/index.html',
  title: 'Weather Dashboard', type: 'html-app', mtime: 2000,
  publishedUrl: 'https://view.mindshub.ai/r/abc',
};

const cloudDraft = {
  ...published,
  id: '11111111111111111111111111111111',
  draftUrl: '/api/v1/artifacts/drafts/project/id/index.html',
  publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
};

// Actions unavailable for a published-only card in org mode. Preview is tested
// separately below with an authenticated cloud draft.
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

  it('offers Download for an artifact with a draft URL, shared or not (ENG-2044)', () => {
    /*
     * The draft URL is the one route to a non-HTML file's bytes on an org
     * deployment. Both menu sites must offer it: the grid is the default view
     * and the only one on mobile, so a list-only item leaves phones stuck.
     */
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    openKebab();
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('does not offer Download without a draft URL', () => {
    // Nothing to save yet: the artifact has no primary file the server can stream.
    render(<ArtifactsView artifacts={[published]} />);
    openKebab();
    expect(screen.queryByText('Download')).toBeNull();
  });
});

describe('list view kebab in org mode', () => {
  /*
   * The row itself previews now, so the menu's first item is the page a
   * collaborator opens, and its label has to say which of the two it is.
   */
  beforeEach(() => {
    localStorage.setItem('anton:artifacts-view', 'list');
    setOrgMode(true);
    host.openExternal.mockClear();
  });

  it('names the shared page and opens it', () => {
    render(<ArtifactsView artifacts={[{
      ...cloudDraft,
      publishedUrl: 'https://view.mindshub.ai/r/abc',
    }]} />);
    openKebab();

    fireEvent.click(screen.getByText('Open shared link'));

    expect(host.openExternal).toHaveBeenCalledWith('https://view.mindshub.ai/r/abc');
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('drops the item entirely before anything is shared', () => {
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    openKebab();
    expect(screen.queryByText('Open shared link')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
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

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view card body in org mode', (_name, view) => {
  beforeEach(() => {
    localStorage.setItem('anton:artifacts-view', view);
    setOrgMode(true);
    host.openExternal.mockClear();
  });

  /*
   * A click means "show me this artifact" here too, and the draft URL carries
   * its own access check, so it does not wait on a publish either.
   */
  it('opens the viewer when the card body is clicked', () => {
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    fireEvent.click(screen.getByText('Weather Dashboard'));
    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent('Private preview');
  });

  it('opens the shared page instead for a draft the viewer cannot render', () => {
    render(<ArtifactsView artifacts={[{
      ...fullstackDraft,
      publishedUrl: 'https://view.mindshub.ai/r/abc',
    }]} />);
    fireEvent.click(screen.getByText('Ops Console'));
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    expect(host.openExternal).toHaveBeenCalledWith('https://view.mindshub.ai/r/abc');
  });

  it('does not offer delete to a reviewer', () => {
    render(<ArtifactsView artifacts={[{
      ...cloudDraft,
      capabilities: { role: 'reviewer', canEdit: false },
    }]} />);
    openKebab();
    expect(screen.queryByText(/Delete/)).toBeNull();
  });
});

describe('grid view card body on desktop', () => {
  // The org narrowing must not leak: locally the body click is still the
  // fastest way into the preview.
  it('still opens the viewer for an inline-previewable artifact', () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    fireEvent.click(screen.getByText('Weather Dashboard'));
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
  });
});


// Fixtures for the type gate. Both carry a draft URL — that alone must not be
// enough, because the viewer cannot render either one in org mode.
const fullstackDraft = {
  ...cloudDraft,
  id: '22222222222242228222222222222222',
  title: 'Ops Console',
  type: 'fullstack-stateless-app',
};

const imageDraft = {
  ...cloudDraft,
  id: '33333333333343338333333333333333',
  title: 'Revenue Chart',
  type: 'image',
  ext: '.png',
  path: '/proj/.anton/artifacts/revenue/chart.png',
};

/*
 * Markdown is publishable (cowork-server PUBLISHABLE_STATIC_SUFFIXES is
 * .html + .md) and org mode auto-publishes, so a shared .md is the ordinary
 * case rather than an edge one.
 */
const publishedMarkdown = {
  ...cloudDraft,
  id: '44444444444444448444444444444444',
  title: 'Weekly Report',
  type: 'report',
  ext: '.md',
  path: '/proj/.anton/artifacts/weekly/report.md',
  publishedUrl: 'https://view.mindshub.ai/r/md1',
};

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view shared link in org mode', (_name, view) => {
  /*
   * The card body previews the draft now, so the menu owns the route to the
   * page a collaborator opens. The grid menu used to gate that item on the
   * artifact being HTML, which is the one test a .md fails, so a shared
   * report had no route to its URL from the grid at all — and grid is the
   * default view and the only view on a phone.
   */
  beforeEach(() => {
    localStorage.setItem('anton:artifacts-view', view);
    setOrgMode(true);
    host.openExternal.mockClear();
  });

  it('offers the shared page for a published markdown artifact', () => {
    render(<ArtifactsView artifacts={[publishedMarkdown]} />);
    openKebab();

    fireEvent.click(screen.getByText('Open shared link'));

    expect(host.openExternal).toHaveBeenCalledWith('https://view.mindshub.ai/r/md1');
  });

  it('drops it again when nothing is shared', () => {
    render(<ArtifactsView artifacts={[{ ...publishedMarkdown, publishedUrl: '' }]} />);
    openKebab();

    expect(screen.queryByText('Open shared link')).toBeNull();
    expect(screen.queryByText('Open in browser')).toBeNull();
  });
});

describe('grid view shared link when the bridge rejects', () => {
  /*
   * Grid-only: this is the page-level HoverMenu's own item. host.openExternal
   * is async, so the item has to await it for its catch to fire — unawaited,
   * this fallback was dead code. The list row routes through `openUrl`, which
   * already awaits.
   */
  it('falls back to window.open', async () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(true);
    host.openExternal.mockClear();
    host.openExternal.mockRejectedValueOnce(new Error('bridge gone'));
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<ArtifactsView artifacts={[publishedMarkdown]} />);
      openKebab();

      fireEvent.click(screen.getByText('Open shared link'));

      await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(
        'https://view.mindshub.ai/r/md1', '_blank', 'noopener,noreferrer',
      ));
    } finally {
      opened.mockRestore();
    }
  });
});

describe('grid view shared link on desktop', () => {
  /*
   * The widening is org-only: on desktop a .md still gets the reveal item, not
   * an "Open in browser" pointing at a page that may not exist.
   */
  it('keeps the HTML-only rule', () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[publishedMarkdown]} />);
    openKebab();

    expect(screen.queryByText('Open in browser')).toBeNull();
    expect(screen.queryByText('Open shared link')).toBeNull();
  });
});

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view preview item in org mode', (_name, view) => {
  beforeEach(() => {
    localStorage.setItem('anton:artifacts-view', view);
    setOrgMode(true);
  });

  it('offers Preview for an artifact the viewer can render', () => {
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    openKebab();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('opens the authenticated draft from the menu item', () => {
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    openKebab();
    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent('Private preview');
  });

  it('offers no Preview for a fullstack app', () => {
    // Its preview needs the loopback proxy, which only Desktop has.
    render(<ArtifactsView artifacts={[fullstackDraft]} />);
    openKebab();
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('offers no Preview for an image', () => {
    // Image bytes come from /artifacts/serve, which org tenancy refuses.
    render(<ArtifactsView artifacts={[imageDraft]} />);
    openKebab();
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('keeps Preview next to the shared link once the artifact is published', () => {
    // Publication state is not part of the gate: the private bytes and what
    // collaborators see are two different things to look at.
    render(<ArtifactsView artifacts={[{
      ...cloudDraft,
      publishedUrl: 'https://view.mindshub.ai/r/abc',
    }]} />);
    openKebab();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });
});

describe('grid view preview item on desktop', () => {
  // The viewer renders images (ENG-1998) and this menu is the only way to reach
  // that: a click on an image card hands the file to the OS. Gating the item on
  // the text/iframe predicate alone dropped them.
  it('keeps Preview for an image', () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[{ ...imageDraft, draftUrl: '' }]} />);
    openKebab();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('offers no Preview for a type the viewer cannot render', () => {
    localStorage.setItem('anton:artifacts-view', 'grid');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[{
      ...published,
      title: 'Scratch script',
      ext: '.py',
      path: '/proj/.anton/artifacts/scratch/main.py',
      publishedUrl: '',
    }]} />);
    openKebab();
    expect(screen.queryByText('Preview')).toBeNull();
  });
});

describe('list view preview item on desktop', () => {
  // The first item is already the viewer entry there ("Open viewer"), so a
  // second one would be the same action twice.
  it('does not duplicate the viewer entry', () => {
    localStorage.setItem('anton:artifacts-view', 'list');
    setOrgMode(false);
    render(<ArtifactsView artifacts={[cloudDraft]} />);
    openKebab();
    expect(screen.getByText('Open viewer')).toBeInTheDocument();
    expect(screen.queryByText('Preview')).toBeNull();
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
