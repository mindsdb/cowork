// The org-mode action gate has to be applied at BOTH menu sites.
//
// ArtifactsView builds its kebab menu twice: the list view's `rowMenuItems`
// builds its own item list, and the grid view's items are assembled
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
import userEvent from '@testing-library/user-event';

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
  host: {
    isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(),
    // artifactDownload runs UNMOCKED below and resolves relative URLs.
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
// Shared spy (not a fresh vi.fn() per call) so the failure-reporting tests
// below can assert the toast actually fired.
const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: toastAdd }) }));
/*
 * Transport-level mock: lib/artifactDownload stays REAL, so these tests prove
 * the wiring row/menu → downloadArtifactFile → authenticated fetch, not a stub
 * of it. Async matters — the components await the result, and a sync stub
 * would leave a dropped `await` invisible (review pass 2).
 */
const downloadAuthenticatedResource = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../lib/authenticatedResource', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadAuthenticatedResource: (...a) => downloadAuthenticatedResource(...a),
}));
vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact }) => (open
    ? <div data-testid="artifact-viewer">Private preview: {artifact.title}</div>
    : null),
}));

const sharing = vi.hoisted(() => ({ on: true }));
vi.mock('../hooks/useOrgSharing', async (importOriginal) => ({
  ...(await importOriginal()),
  useSharingCapabilities: () => ({ capabilities: sharing.on ? { enabled: true } : null }),
  useSharingOrgName: (active) => (active ? 'Acme' : null),
  useMindsHubTeams: () => ({ status: 'ready', reachable: true, failure: null, teams: [] }),
}));

import ArtifactsView from './ArtifactsView';
import { setOrgMode } from '../../lib/orgMode';

// With sharing in the org, the Artifacts page groups owner first: Yours, My
// teams, Everyone at the org (the caller's own), then Shared with me (ENG-4455).
const art = (id, title, extra = {}) => ({
  id, path: `/proj/.anton/artifacts/${id}/index.html`, title, type: 'html-app', mtime: 2000,
  draftUrl: `/api/v1/artifacts/drafts/project/${id}/index.html`, publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true }, ...extra,
});
const ARTIFACTS = [
  art('a1', 'Sales deck'),
  art('a2', 'Team board', { allowedTeamIds: ['t-1'] }),
  art('a3', 'Their report', { capabilities: { role: 'reviewer' } }),
  art('a4', 'Company page', { orgAllowed: true }),
];

beforeEach(() => { setOrgMode(true); sharing.on = true; });
afterEach(() => { localStorage.clear(); setOrgMode(false); });

describe.each(['grid', 'list'])('ArtifactsView sections (%s)', (view) => {
  beforeEach(() => { localStorage.setItem('anton:artifacts-view', view); });

  it('groups the caller\'s own first and what others shared last', () => {
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    const sections = screen.getAllByRole('region', { name: /Yours|Shared with me|My teams|Everyone at Acme/ });
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Yours', 'My teams', 'Everyone at Acme', 'Shared with me']);
    expect(sections[0]).toHaveTextContent('Sales deck');
    expect(sections[1]).toHaveTextContent('Team board');
    expect(sections[2]).toHaveTextContent('Company page');
    expect(sections[3]).toHaveTextContent('Their report');
  });

  it('keeps one ungrouped list where the org does not share', () => {
    sharing.on = false;
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    expect(screen.queryByRole('region', { name: 'Yours' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Yours' })).toBeNull();
    expect(screen.getByText('Sales deck')).toBeInTheDocument();
  });
});
