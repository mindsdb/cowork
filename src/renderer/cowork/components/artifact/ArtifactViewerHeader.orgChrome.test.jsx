// What the preview window offers, per deployment mode.
//
// Org mode is a review surface for MVP: sharing controls and the actions kebab
// are not part of it, and both used to render there because the header only ever
// asked about capabilities. Delete stays reachable from the gallery card.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn() },
}));
// Stubbed to a bare button: the real menu drives a whole publish controller
// (versions, access drafts, passwords), and none of that is what this file is
// about — only whether the header renders sharing at all.
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
  // Sharing used to be hidden here, on the grounds that publishing "lives on the
  // gallery card instead" — but the card filters publish out in org mode too, so
  // Cloud had no way to share an artifact at all. It is owner-side chrome on both
  // deployments now (ENG-2316).
  it('offers sharing', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: /Share/ })).toBeInTheDocument();
  });

  // The ⋯ menu stays hidden: its entries are OS/file actions plus `/publish`
  // routes, none of which an org deployment can answer. Sharing is the one
  // affordance that was wrongly grouped with them.
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
