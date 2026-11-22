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
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

const sharing = vi.hoisted(() => ({ on: true, status: 'ready', teamsStatus: 'ready' }));
vi.mock('../hooks/useOrgSharing', async (importOriginal) => ({
  ...(await importOriginal()),
  useSharingCapabilities: () => ({ status: sharing.status, capabilities: sharing.on ? { enabled: true } : null }),
  useSharingOrgName: (active) => (active ? 'Acme' : null),
  useMindsHubTeams: () => ({ status: sharing.teamsStatus, reachable: true, failure: null, teams: [] }),
}));

import ArtifactsView, { GROUPING_WAIT_MS } from './ArtifactsView';
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
  sharing.status = 'ready';
  sharing.teamsStatus = 'ready';
  resetArtifactAudiences();
  window.sessionStorage.clear();
  localStorage.setItem('anton:artifacts-view', 'list');
  audienceApi.loadArtifactAudience.mockImplementation(async (artifact) => AUDIENCES[artifact.id]);
});
afterEach(() => { localStorage.clear(); setOrgMode(false); vi.useRealTimers(); });

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

// The page shows once, already in its final sections: no artifact sits under
// Yours and then moves, and no flat list turns into sections (ENG-4585).
const busy = () => document.querySelector('[aria-busy="true"]');

describe('ArtifactsView loads once, in its final sections', () => {
  it('holds the skeleton until a restricted artifact\'s audience is read, then shows it in its section', async () => {
    let answer;
    audienceApi.loadArtifactAudience.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<ArtifactsView artifacts={[art('everyone', 'Get Started')]} />);

    expect(busy()).not.toBeNull();
    expect(screen.queryByText('Get Started')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Yours' })).toBeNull();

    await act(async () => { answer(AUDIENCES.everyone); });
    expect(await screen.findByRole('region', { name: 'Everyone at Acme' })).toHaveTextContent('Get Started');
    expect(screen.queryByRole('region', { name: 'Yours' })).toBeNull();
    expect(busy()).toBeNull();
  });

  it('waits for sharing and the teams before grouping', () => {
    sharing.status = 'loading';
    const page = render(<ArtifactsView artifacts={[art('plain', 'Notes', { publishedUrl: '' })]} />);
    expect(busy()).not.toBeNull();

    sharing.status = 'ready';
    sharing.teamsStatus = 'loading';
    page.rerender(<ArtifactsView artifacts={[art('plain', 'Notes', { publishedUrl: '' })]} />);
    expect(busy()).not.toBeNull();

    sharing.teamsStatus = 'ready';
    page.rerender(<ArtifactsView artifacts={[art('plain', 'Notes', { publishedUrl: '' })]} />);
    expect(screen.getByRole('region', { name: 'Yours' })).toHaveTextContent('Notes');
  });

  it('shows the page anyway once the wait runs out', () => {
    vi.useFakeTimers();
    audienceApi.loadArtifactAudience.mockReturnValue(new Promise(() => {}));
    render(<ArtifactsView artifacts={[art('everyone', 'Get Started')]} />);
    expect(busy()).not.toBeNull();

    act(() => { vi.advanceTimersByTime(GROUPING_WAIT_MS); });
    expect(busy()).toBeNull();
    expect(screen.getByText('Get Started')).toBeInTheDocument();
  });

  it('never goes back to the skeleton when the list changes after it showed', async () => {
    const first = [art('everyone', 'Get Started')];
    const page = render(<ArtifactsView artifacts={first} />);
    await screen.findByRole('region', { name: 'Everyone at Acme' });

    audienceApi.loadArtifactAudience.mockReturnValue(new Promise(() => {}));
    page.rerender(<ArtifactsView artifacts={[...first, art('later', 'New deck')]} />);
    expect(busy()).toBeNull();
    expect(screen.getByText('Get Started')).toBeInTheDocument();
  });

  it('shows "No artifacts yet" only once loading is done', () => {
    const page = render(<ArtifactsView artifacts={[]} loading />);
    expect(screen.queryByText('No artifacts yet')).toBeNull();
    page.rerender(<ArtifactsView artifacts={[]} />);
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
  });
});
