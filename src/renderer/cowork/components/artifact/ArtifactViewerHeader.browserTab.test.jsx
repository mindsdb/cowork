// "Open in a browser tab" beside the mode tabs.
//
// It lives there rather than in the ⋯ menu because that menu is hidden in org
// mode — its other entries are OS/file actions and `/publish` routes an org
// deployment cannot answer — while this affordance belongs on both. So the
// assertions that matter are: it shows on Cloud once the artifact is shared,
// and it does not appear when there is nothing for it to open. Before that,
// Cloud's only URL is the draft route, which a tab can't load without the
// bearer.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: false,
    isElectron: true,
    isMac: () => false,
    openExternal: vi.fn(),
    getApiOrigin: () => 'http://127.0.0.1:26866',
  },
}));

import ArtifactViewerHeader from './ArtifactViewerHeader';

const onOpenInBrowserTab = vi.fn();

const props = {
  title: 'Storefront',
  workspace: {
    supported: true,
    status: 'ready',
    mode: 'preview',
    setMode: vi.fn(),
    source: { path: 'index.html', content: '<h1>Hi</h1>' },
    capabilities: { role: 'owner', canEdit: true },
    unsupportedReason: '',
  },
  review: { enabled: true, open: false, controller: { unreadCount: 0 }, onToggle: vi.fn() },
  publication: {
    canManage: true,
    publishable: true,
    controller: { publishedUrl: '', setError: vi.fn(), loadVersions: vi.fn() },
    hasActionPath: true,
    isPublished: false,
    disabledReason: '',
  },
  actions: {
    canOpenInBrowserTab: true,
    canOpenLocalFile: false,
    isBackendArtifact: false,
    backendPort: null,
    artifact: { serveUrl: '' },
    deleteBusy: false,
    onReload: vi.fn(),
    onOpenInBrowserTab,
    onOpenFolder: vi.fn(),
    onOpenOS: vi.fn(),
    onDownload: vi.fn(),
    onTrash: vi.fn(),
  },
  onClose: vi.fn(),
};

const shared = {
  ...props,
  publication: {
    ...props.publication,
    controller: { ...props.publication.controller, publishedUrl: 'https://pages.example/storefront', versions: [] },
    isPublished: true,
  },
};

const withoutUrl = {
  ...props,
  actions: { ...props.actions, canOpenInBrowserTab: false },
};

// A running live app, never shared as a page: the arrow opens its address.
const liveApp = {
  ...props,
  actions: { ...props.actions, isBackendArtifact: true, isLiveApp: true },
};

afterEach(() => {
  setOrgMode(false);
  onOpenInBrowserTab.mockClear();
});

describe('open in a browser tab', () => {
  it('is offered on Cloud for a shared artifact, where the actions menu is not', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...shared} />);

    expect(screen.getByRole('button', { name: 'Open in a browser tab' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('hides on Cloud until the artifact is shared', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.queryByRole('button', { name: 'Open in a browser tab' })).toBeNull();
  });

  it('is offered on Cloud for a live app nobody shared as a page, since it opens where the app runs', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...liveApp} />);

    expect(screen.getByRole('button', { name: 'Open in a browser tab' })).toBeInTheDocument();
  });

  it('is offered on desktop too', () => {
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: 'Open in a browser tab' })).toBeInTheDocument();
  });

  it('hides when there is no URL to open', () => {
    // A button that opens nothing is worse than no button.
    render(<ArtifactViewerHeader {...withoutUrl} />);

    expect(screen.queryByRole('button', { name: 'Open in a browser tab' })).toBeNull();
  });

  it('hands the click to the opener', () => {
    render(<ArtifactViewerHeader {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open in a browser tab' }));
    expect(onOpenInBrowserTab).toHaveBeenCalled();
  });
});
