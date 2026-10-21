/*
 * What the viewer header offers for each file in each deployment mode: a
 * visible Download on web, a visible Open with Download and Show in folder in
 * its menu on desktop, a browser tab only for a file a tab shows on web, a ⋯
 * menu without the entries that became visible controls, and an Export button
 * that lists exactly the server's formats. The cases live in
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
  workspaceCapabilities,
  artifactCapabilities,
  authorship = null,
  isPublished = false,
} = {}) {
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
      controller: { publishedUrl: isPublished ? 'https://pages.example/storefront' : '' },
      hasActionPath: true,
      isPublished,
      disabledReason: '',
    },
    actions: {
      canOpenInBrowser: true,
      canOpenInBrowserTab: true,
      canOpenLocalFile: mode.localFiles,
      isBackendArtifact: type === 'fullstack-stateless-app',
      backendPort: 5050,
      artifact: {
        path,
        type,
        draftUrl: `${DRAFT_URL}${path}`,
        serveUrl: mode.serveUrl ? `${SERVE_URL}${path}` : '',
        capabilities: artifactCapabilities,
      },
      deleteBusy: false,
      onReload: vi.fn(),
      onOpenInBrowser: vi.fn(),
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
    const showsTab = !mode.tabRule || file.showsInTab;

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
      const moreItems = await menuItemNames(user, 'More actions');
      for (const dropped of cases.droppedFromMoreActions) expect(moreItems).not.toContain(dropped);
      expect(moreItems.includes('Open in browser')).toBe(mode.openInBrowser && showsTab);
    }
  });

  /* A full-stack app addressed by its folder has no extension, so only its
     published page makes it a file a tab shows. */
  it('offers a published artifact\'s shared page', async () => {
    useMode(mode);
    const user = userEvent.setup();
    render(<ArtifactViewerHeader {...headerProps(mode, {
      path: 'storefront',
      type: 'fullstack-stateless-app',
      isPublished: true,
    })} />);

    expect(screen.getByRole('button', { name: 'Open in a browser tab' })).toBeInTheDocument();
    if (mode.moreActions) {
      expect(await menuItemNames(user, 'More actions')).toContain(cases.sharedLinkLabel);
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
