// Check deployment-specific preview chrome: owner sharing is available on Cloud; OS/file actions
// remain desktop-only.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn() },
}));
// Stub the publish controller to test header visibility independently of access/version state.
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';
import { setOrgMode } from '../../../lib/orgMode';

const workspace = {
  supported: true,
  status: 'ready',
  mode: 'preview',
  setMode: vi.fn(),
  source: { path: 'index.html', content: '<h1>Hi</h1>' },
  capabilities: { role: 'owner', canEdit: true },
  unsupportedReason: '',
};

const props = {
  title: 'Weather Dashboard',
  workspace,
  review: {
    enabled: true,
    open: false,
    controller: { unreadCount: 0 },
    onToggle: vi.fn(),
  },
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
    canOpenLocalFile: false,
    isBackendArtifact: false,
    backendPort: null,
    artifact: { serveUrl: '' },
    deleteBusy: false,
    onReload: vi.fn(),
    onOpenInBrowser: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenOS: vi.fn(),
    onDownload: vi.fn(),
    onTrash: vi.fn(),
  },
  onClose: vi.fn(),
};

afterEach(() => setOrgMode(false));

describe('preview window chrome in org mode', () => {
  // Cloud owners need Share in the viewer; filtering it from both viewer and gallery leaves no
  // sharing route.
  it('offers sharing', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: /Share/ })).toBeInTheDocument();
  });

  // Keep org-mode OS/file and local publish actions hidden while exposing owner sharing separately.
  it('still hides the OS/file actions menu', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('keeps review and close', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
  });
});

describe('preview window chrome on desktop', () => {
  // The menu's removal must stay mode-scoped, or the assertion above is vacuous.
  it('keeps sharing and the actions menu', () => {
    setOrgMode(false);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: /Share/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });
});
