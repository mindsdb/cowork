// What the preview window offers, per deployment mode.
//
// Org mode is a review surface for MVP: sharing controls and the actions kebab
// are not part of it, and both used to render there because the header only ever
// asked about capabilities. Delete stays reachable from the gallery card.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Reporting is offered only in the mobile app.
vi.mock('../../../lib/mobileShell', async (importOriginal) => ({ ...(await importOriginal()), isMobileShell: true }));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isMac: () => false,
    openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
// Stubbed to a bare button: the real menu drives a whole publish controller
// (versions, access drafts, passwords), and none of that is what this file is
// about — only whether the header renders sharing at all.
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));
vi.mock('./publish/SharedWithMenu', () => ({
  SharedWithMenu: () => <button type="button">Shared (read-only)</button>,
}));

import * as api from '../../api';
import { ArtifactViewerHeader } from './ArtifactViewerHeader';
import { setOrgMode } from '../../../lib/orgMode';
import { artifactAuthorship } from '../../lib/artifactAuthorship';

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
    canOpenLocalFile: false,
    isBackendArtifact: false,
    backendPort: null,
    artifact: { serveUrl: '' },
    deleteBusy: false,
    onReload: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenOS: vi.fn(),
    onDownload: vi.fn(),
    onTrash: vi.fn(),
  },
  onClose: vi.fn(),
};

afterEach(() => {
  setOrgMode(false);
  vi.restoreAllMocks();
});

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

  it.each(['revision', 'mtime'])('lets a viewer report changed content when its %s changes', async (field) => {
    setOrgMode(true);
    const report = vi.spyOn(api, 'reportArtifactContent').mockResolvedValue({ id: 'receipt', status: 'received' });
    const artifact = { projectId: '9c8d86e7-8b7a-4d2a-8981-385b369af213', id: 'a8c2272e0000400080000000000000aa', mtime: 100 };
    const header = (revisionId, mtime) => (
      <ArtifactViewerHeader {...props} workspace={{ ...workspace, currentRevision: revisionId ? { id: revisionId } : null }}
        actions={{ ...props.actions, artifact: { ...artifact, mtime } }} />
    );
    const firstRevision = field === 'revision' ? 'revision-one' : null;
    const view = render(header(firstRevision, 100));
    const button = () => screen.getByRole('button', { name: 'Report content' });
    const submitReport = async () => {
      fireEvent.click(button());
      fireEvent.click(await screen.findByRole('button', { name: 'Send report' }));
      expect(await screen.findByText('Report received.')).toBeInTheDocument();
    };
    await submitReport();
    view.rerender(header(firstRevision, 100));
    expect(button()).toBeDisabled();

    view.rerender(field === 'revision' ? header('revision-two', 100) : header(null, 101));
    expect(button()).toBeEnabled();
    expect(screen.queryByText('Report received.')).not.toBeInTheDocument();
    await submitReport();
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(artifact.projectId, artifact.id);
  });

  // The ⋯ menu stays hidden: its entries are OS/file actions plus `/publish`
  // routes, none of which an org deployment can answer. Sharing is the one
  // affordance that was wrongly grouped with them.
  it('still hides the OS/file actions menu', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('keeps the address and close; Comments moved to the revision line', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    // The address pill took the mode tabs' place.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(document.querySelector('.artifact-address-pill')).not.toBeNull();
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

// ENG-2979: the preview says whose artifact it is, right after the title.
describe('preview window authorship tag', () => {
  const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('tags another member\'s artifact right after the title', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} authorship={artifactAuthorship({ role: 'reviewer' })} />);
    const title = document.getElementById('artifact-viewer-title');
    const tag = screen.getByText('Another member');
    expect(title.parentElement).toContainElement(tag);
    expect(follows(title, tag)).toBe(true);
  });

  // Fix wave (code review): the badge is a direct flex child of the title
  // zone, no anonymous wrapper span — so `shrink-0` has to land on the pill
  // itself for a long title to truncate before the tag does.
  it('gives the tag pill shrink-0, with no wrapper between it and the title', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} authorship={artifactAuthorship({ role: 'reviewer' })} />);
    const title = document.getElementById('artifact-viewer-title');
    const pill = screen.getByText('Another member').closest('.rounded-full');
    expect(pill.className).toContain('shrink-0');
    expect(pill.parentElement).toBe(title.parentElement);
  });

  it('tags an ownerless artifact', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} authorship={artifactAuthorship({ role: 'reviewer', ownerUnknown: true })} />);
    expect(screen.getByText('Unknown owner')).toBeInTheDocument();
  });

  it('shows no tag for the viewer\'s own artifact', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...props} authorship={null} />);
    expect(screen.queryByText('Another member')).toBeNull();
    expect(screen.queryByText('Unknown owner')).toBeNull();
  });

  it('shows no tag when the prop is not passed', () => {
    render(<ArtifactViewerHeader {...props} />);
    expect(screen.queryByText('Another member')).toBeNull();
  });
});

// ENG-3002: the preview's own errors are a header button on both deployments.
// The button itself is covered in PreviewErrorsButton.test.jsx.
describe('preview errors button', () => {
  const diagnostics = {
    errors: [{ message: 'boom', file: 'a.html', line: 1 }],
    dismissed: false,
    dismiss: vi.fn(),
  };

  it.each([true, false])('is offered with orgMode=%s', (org) => {
    setOrgMode(org);
    render(<ArtifactViewerHeader {...props} diagnostics={diagnostics} />);

    expect(screen.getByRole('button', { name: 'Preview errors, 1' })).toBeInTheDocument();
  });
});

// IconButton renders aria-pressed only for a real toggle.
describe('top-bar toggle semantics', () => {
  it('leaves it off plain actions', () => {
    render(<ArtifactViewerHeader {...props} />);

    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'More actions' })).not.toHaveAttribute('aria-pressed');
  });
});

// ENG-4455: someone else's shared artifact keeps a "Shared" button, opening the
// read-only panel, and its tag names the owner.
describe('a colleague\'s artifact in org mode', () => {
  const reviewer = (over = {}) => ({
    ...props,
    authorship: artifactAuthorship({ role: 'reviewer', canEdit: false, ownerUserId: 'u-ana' }, { ownerName: 'Ana Ruiz' }),
    workspace: { ...workspace, capabilities: { role: 'reviewer', canEdit: false, ownerUserId: 'u-ana' } },
    publication: { ...props.publication, canManage: false, isPublished: true, controller: { ...props.publication.controller, publishedUrl: 'https://share/abc' } },
    actions: { ...props.actions, artifact: { id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70', projectId: 'proj-1', publishedUrl: 'https://share/abc' } },
    ...over,
  });

  it('names the owner and offers the read-only Shared panel, not the owner\'s', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...reviewer()} />);

    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shared (read-only)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('keeps "Another member" until the name is in', () => {
    setOrgMode(true);
    render(<ArtifactViewerHeader {...reviewer({ authorship: artifactAuthorship({ role: 'reviewer', ownerUserId: 'u-ana' }) })} />);

    expect(screen.getByText('Another member')).toBeInTheDocument();
  });

  it('offers nothing while it is not published', () => {
    setOrgMode(true);
    const r = reviewer();
    render(<ArtifactViewerHeader {...r} publication={{ ...r.publication, isPublished: false }} />);

    expect(screen.queryByRole('button', { name: /Shared/ })).toBeNull();
  });

  it('leaves the owner with their own Share control', () => {
    setOrgMode(true);
    const r = reviewer({ authorship: null });
    render(<ArtifactViewerHeader {...r} publication={{ ...r.publication, canManage: true }} />);

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Shared (read-only)' })).toBeNull();
  });

  it('is an org-mode control only', () => {
    setOrgMode(false);
    render(<ArtifactViewerHeader {...reviewer()} />);

    expect(screen.queryByRole('button', { name: 'Shared (read-only)' })).toBeNull();
  });
});
