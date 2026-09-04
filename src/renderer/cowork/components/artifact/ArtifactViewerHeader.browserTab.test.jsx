// "Open in a browser tab" beside the mode tabs.
//
// It lives there rather than in the ⋯ menu because that menu is hidden in org
// mode — its other entries are OS/file actions and `/publish` routes an org
// deployment cannot answer — while this affordance belongs on both. So the
// assertions that matter are: it shows on Cloud, and it does not appear when
// there is nothing for it to open.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

vi.mock('../../../platform/host', () => ({
  host: { isWeb: false, isElectron: true, isMac: () => false, openExternal: vi.fn() },
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
    canOpenInBrowser: false,
    canOpenInBrowserTab: true,
    canOpenLocalFile: false,
    isBackendArtifact: false,
    backendPort: null,
    artifact: { serveUrl: '' },
    deleteBusy: false,
    onReload: vi.fn(),
    onOpenInBrowser: vi.fn(),
    onOpenInBrowserTab,
    onOpenFolder: vi.fn(),
    onOpenOS: vi.fn(),
    onDownload: vi.fn(),
    onTrash: vi.fn(),
  },
  onClose: vi.fn(),
};

const withoutUrl = {
  ...props,
  actions: { ...props.actions, canOpenInBrowserTab: false },
};

afterEach(() => {
  setOrgMode(false);
  onOpenInBrowserTab.mockClear();
});

describe('open in a browser tab', () => {
  it('is offered on Cloud, where the actions menu is not', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: 'Open in a browser tab' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
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
