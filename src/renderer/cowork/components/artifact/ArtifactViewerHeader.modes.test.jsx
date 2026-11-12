/*
 * What the viewer header offers for each file in each deployment mode: a
 * visible Download on web, a visible Open with Download and Show in folder in
 * its menu on desktop, a browser tab only for a file a tab shows on web, a ⋯
 * menu that repeats none of those controls, and an Export button that lists
 * exactly the server's formats. The cases live in
 * ArtifactViewerHeader.modes.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockHost = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  mac: false,
  isMac() { return this.mac; },
  getApiOrigin: () => 'https://cowork.example',
}));
vi.mock('../../../platform/host', () => ({ host: mockHost }));
// Sharing has its own tests; only the controls around it are under test here.
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';
import { setOrgMode } from '../../../lib/orgMode';
import { artifactAuthorship } from '../../lib/artifactAuthorship';

const cases = load(readFileSync(resolve(__dirname, 'ArtifactViewerHeader.modes.test.yaml'), 'utf8'));
const modeNamed = (name) => cases.modes.find((mode) => mode.name === name);

const DRAFT_URL = '/api/v1/artifacts/drafts/proj-1/7db94eb8f0a54c7e9c1d2b3a4f5e6d70/';
const SERVE_URL = '/api/v1/artifacts/serve/proj/';

function useMode(mode) {
  mockHost.isWeb = mode.web;
  mockHost.isElectron = !mode.web;
  mockHost.mac = mode.mac;
  setOrgMode(mode.org);
}

function headerProps(mode, {
  path = 'notes.md',
  type,
  hasUrls = true,
  hasDraftUrl = hasUrls,
  workspaceCapabilities,
  artifactCapabilities,
  authorship = null,
  isPublished = false,
} = {}) {
  const publishedUrl = isPublished ? 'https://pages.example/storefront' : '';
  const serveUrl = hasUrls && mode.serveUrl ? `${SERVE_URL}${path}` : '';
  const draftUrl = hasDraftUrl ? `${DRAFT_URL}${path}` : '';
  return {
    title: path,
    authorship: authorship && artifactAuthorship(authorship),
    workspace: {
      supported: true,
      status: 'ready',
      mode: 'preview',
      setMode: vi.fn(),
      source: null,
      capabilities: workspaceCapabilities === undefined ? { role: 'owner', canEdit: true } : workspaceCapabilities,
      unsupportedReason: '',
    },
    review: { enabled: false, open: false, controller: { unreadCount: 0 }, onToggle: vi.fn() },
    publication: {
      canManage: true,
      publishable: false,
      controller: { publishedUrl },
      hasActionPath: true,
      isPublished,
      disabledReason: '',
    },
    actions: {
      /* ArtifactViewer opens a browser tab on the first of these it holds. */
      canOpenInBrowserTab: !!(publishedUrl || serveUrl || draftUrl),
      canOpenLocalFile: mode.localFiles,
      isBackendArtifact: type === 'fullstack-stateless-app',
      backendPort: 5050,
      artifact: {
        path,
        type,
        draftUrl,
        serveUrl,
        capabilities: artifactCapabilities,
      },
      deleteBusy: false,
      onReload: vi.fn(),
      onOpenInBrowserTab: vi.fn(),
      onOpenFolder: vi.fn(),
      onOpenOS: vi.fn(),
      onDownload: vi.fn(),
      onTrash: vi.fn(),
    },
    onClose: vi.fn(),
  };
}

async function menuItemNames(user, triggerName) {
  await user.click(screen.getByRole('button', { name: triggerName }));
  const menu = await screen.findByRole('menu');
  const names = within(menu).getAllByRole('menuitem').map((item) => item.textContent);
  await user.keyboard('{Escape}');
  return names;
}

afterEach(() => {
  cleanup();
  setOrgMode(false);
});

describe.each(cases.modes)('the viewer header on $name', (mode) => {
  it.each(cases.files)('offers the right controls for $path', async (file) => {
    useMode(mode);
    const user = userEvent.setup();
    render(<ArtifactViewerHeader {...headerProps(mode, file)} />);
    const downloadable = file.downloadable !== false;
    const showsTab = !mode.tabNeedsShare && (!mode.tabRule || file.showsInTab) && file.hasUrls !== false;

    const headerDownload = screen.queryByRole('button', { name: 'Download' });
    expect(!!headerDownload).toBe(mode.download === 'header' && downloadable);
    expect(!!screen.queryByRole('button', { name: /^Open$/ })).toBe(mode.download === 'open-menu');
    expect(!!screen.queryByRole('button', { name: 'Open in a browser tab' })).toBe(showsTab);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    if (mode.download === 'open-menu') {
      const expected = [...(downloadable ? ['Download'] : []), ...(mode.revealLabel ? [mode.revealLabel] : [])];
      if (expected.length === 0) expect(screen.queryByRole('button', { name: 'More ways to open' })).toBeNull();
      else expect(await menuItemNames(user, 'More ways to open')).toEqual(expected);
    }

    expect(!!screen.queryByRole('button', { name: 'More actions' })).toBe(mode.moreActions);
    if (mode.moreActions) {
      expect(await menuItemNames(user, 'More actions')).toEqual(cases.moreActionsMenu);
    }
  });

  /* A full-stack app addressed by its folder has no extension, so only its
     published page makes it a file a tab shows. The arrow opens that page,
     so the ⋯ menu doesn't offer it again. */
  it('offers a published artifact\'s shared page once', async () => {
    useMode(mode);
    const user = userEvent.setup();
    render(<ArtifactViewerHeader {...headerProps(mode, {
      path: 'storefront',
      type: 'fullstack-stateless-app',
      isPublished: true,
    })} />);

    expect(screen.getByRole('button', { name: 'Open in a browser tab' })).toBeInTheDocument();
    if (mode.moreActions) {
      expect(await menuItemNames(user, 'More actions')).toEqual(cases.moreActionsMenu);
    }
  });
});

describe('the viewer header controls', () => {
  it('saves through the viewer download action from the web Download button', () => {
    useMode(modeNamed('org web'));
    const props = headerProps(modeNamed('org web'), { path: 'model.xlsx' });
    render(<ArtifactViewerHeader {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(props.actions.onDownload).toHaveBeenCalledTimes(1);
  });

  it('opens the file in its default app from the desktop Open button', () => {
    useMode(modeNamed('desktop on macOS'));
    const props = headerProps(modeNamed('desktop on macOS'), { path: 'model.xlsx' });
    render(<ArtifactViewerHeader {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /^Open$/ }));

    expect(props.actions.onOpenOS).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Download', 'onDownload'],
    ['Show in Finder', 'onOpenFolder'],
  ])('runs %s from the desktop Open menu', async (label, action) => {
    useMode(modeNamed('desktop on macOS'));
    const user = userEvent.setup();
    const props = headerProps(modeNamed('desktop on macOS'), { path: 'brief.docx' });
    render(<ArtifactViewerHeader {...props} />);

    await user.click(screen.getByRole('button', { name: 'More ways to open' }));
    await user.click(await screen.findByRole('menuitem', { name: label }));

    expect(props.actions[action]).toHaveBeenCalledTimes(1);
  });

  it('keeps Open disabled for a full-stack app until its backend port is known', () => {
    useMode(modeNamed('desktop on macOS'));
    const props = headerProps(modeNamed('desktop on macOS'), {
      path: 'storefront/static/index.html',
      type: 'fullstack-stateless-app',
    });
    props.actions.backendPort = null;
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: /^Open$/ })).toBeDisabled();
  });
});

describe('the layer toggles', () => {
  const viewerLayers = (over = {}) => ({
    layers: { liveEdit: true, source: false, comments: false },
    setLayer: vi.fn(),
    canLiveEdit: true,
    canSource: true,
    ...over,
  });

  it('offers only the layers this person may use', () => {
    useMode(modeNamed('local web'));
    const props = headerProps(modeNamed('local web'), { path: 'page.html' });
    render(<ArtifactViewerHeader {...props} viewerLayers={viewerLayers({ canLiveEdit: false, canSource: false })} />);

    expect(screen.queryByRole('button', { name: 'Live edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    // review.enabled is false in these props: no Comments either.
    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows each allowed layer pressed or not, and switches it', () => {
    useMode(modeNamed('local web'));
    const props = headerProps(modeNamed('local web'), { path: 'page.html' });
    const layers = viewerLayers();
    props.review = { ...props.review, enabled: true, open: true, controller: { unreadCount: 0 }, onToggle: vi.fn() };
    render(<ArtifactViewerHeader {...props} viewerLayers={layers} />);

    expect(screen.getByRole('button', { name: 'Live edit' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Comments' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    expect(layers.setLayer).toHaveBeenCalledWith('source', true);
    expect(layers.setLayer).toHaveBeenCalledWith('liveEdit', false);
    expect(props.review.onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps the unread badge on the Comments toggle', () => {
    useMode(modeNamed('local web'));
    const props = headerProps(modeNamed('local web'), { path: 'page.html' });
    props.review = { ...props.review, enabled: true, open: false, controller: { unreadCount: 3 }, onToggle: vi.fn() };
    render(<ArtifactViewerHeader {...props} viewerLayers={viewerLayers()} />);

    expect(screen.getByRole('button', { name: /3 unread/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe.each(cases.export)('Export for $name', (exportCase) => {
  it(exportCase.shows.length ? `lists ${exportCase.shows.join(', ')}` : 'is hidden', async () => {
    const mode = modeNamed(exportCase.mode);
    useMode(mode);
    const user = userEvent.setup();
    render(<ArtifactViewerHeader {...headerProps(mode, {
      path: 'notes.md',
      workspaceCapabilities: exportCase.workspace,
      artifactCapabilities: exportCase.artifact,
      authorship: exportCase.authorship,
      hasDraftUrl: exportCase.hasDraftUrl,
    })} />);

    if (exportCase.shows.length === 0) {
      expect(screen.queryByRole('button', { name: /^Export/ })).toBeNull();
    } else {
      expect(await menuItemNames(user, /^Export/)).toEqual(exportCase.shows);
    }
    if (exportCase.download) {
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    }
  });
});
