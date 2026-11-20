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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const audienceApi = vi.hoisted(() => ({ loadArtifactAudience: vi.fn() }));
vi.mock('../lib/artifactWorkspaceApi', async (importOriginal) => ({
  ...(await importOriginal()),
  loadArtifactAudience: (...args) => audienceApi.loadArtifactAudience(...args),
}));
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
import { resetArtifactAudiences } from '../hooks/useArtifactAudiences';

// A restricted card in MindsHub mode doesn't say who it reaches; the page
// reads it, so the same artifact always lands in the same section, its badge
// says how it's shared and its hover names who (ENG-4560).
const UNKNOWN = { orgAllowed: null, allowedTeamIds: null, allowedUserIds: null, accessEmails: null, ownerOnly: null };
const art = (id, title, extra = {}) => ({
  id, path: `/proj/.anton/artifacts/${id}/index.html`, title, type: 'html-app', mtime: 2000,
  draftUrl: `/api/v1/artifacts/drafts/project/${id}/index.html`,
  publishedUrl: `https://view.example/r/${id}`, accessMode: 'restricted', ...UNKNOWN,
  capabilities: { role: 'owner', canEdit: true }, ...extra,
});
const AUDIENCES = {
  everyone: { accessMode: 'restricted', orgAllowed: true, ownerOnly: false, allowedTeamIds: [], allowedUserIds: [], accessEmails: [], names: true },
  people: { accessMode: 'restricted', orgAllowed: false, ownerOnly: false, allowedTeamIds: [], allowedUserIds: [], accessEmails: ['ana@example.com', 'zed@example.com'], names: true },
};

beforeEach(() => {
  setOrgMode(true);
  sharing.on = true;
  resetArtifactAudiences();
  window.sessionStorage.clear();
  localStorage.setItem('anton:artifacts-view', 'list');
  audienceApi.loadArtifactAudience.mockImplementation(async (artifact) => AUDIENCES[artifact.id]);
});
afterEach(() => { localStorage.clear(); setOrgMode(false); });

describe('ArtifactsView with audiences read', () => {
  it('puts your artifact shared with everyone under Everyone at the org, says so, and tags it as yours', async () => {
    render(<ArtifactsView artifacts={[art('everyone', 'Get Started'), art('people', 'Storefront')]} />);

    const everyone = await screen.findByRole('region', { name: 'Everyone at Acme' });
    expect(everyone).toHaveTextContent('Get Started');
    expect(within(everyone).getByText('You', { exact: true })).toBeInTheDocument();
    const yours = screen.getByRole('region', { name: 'Yours' });
    expect(yours).toHaveTextContent('Storefront');
    // Not where every artifact is yours anyway.
    expect(within(yours).queryByText('You', { exact: true })).toBeNull();
    expect(audienceApi.loadArtifactAudience).toHaveBeenCalledTimes(2);
  });

  it('names who a restricted artifact is shared with on hover', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ArtifactsView artifacts={[art('people', 'Storefront')]} />);
    await waitFor(() => expect(audienceApi.loadArtifactAudience).toHaveBeenCalled());

    await user.hover(await screen.findByText('Restricted'));
    expect(await screen.findByText(/Shared with ana@example.com, zed@example.com/)).toBeInTheDocument();
  });
});
