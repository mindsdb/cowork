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
import { pickFilter } from '../../../../tests/helpers/pickOption';

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
  useKnownPeople: (ids) => ({ people: ids.map((id) => ({ id, name: id === 'u-bo' ? 'Bo Chen' : null })) }),
}));

import ArtifactsView from './ArtifactsView';
import { setOrgMode } from '../../lib/orgMode';

// The Artifacts page filters by Type, Status and Owner from the Filter menu,
// each facet only where it would narrow the list, with one Clear (ENG-4560).
const art = (id, title, extra = {}) => ({
  id, path: `/proj/.anton/artifacts/${id}/index.html`, title, type: 'html-app', mtime: 2000,
  draftUrl: `/api/v1/artifacts/drafts/project/${id}/index.html`, publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true }, ...extra,
});
const ARTIFACTS = [
  art('a1', 'Sales deck', { kind: 'html', publishedUrl: 'https://view.example/r/1' }),
  art('a2', 'Board notes', { kind: 'md', path: '/proj/.anton/artifacts/a2/notes.md' }),
  art('a3', 'Their report', { kind: 'html', capabilities: { role: 'reviewer', ownerUserId: 'u-bo' } }),
  art('a4', 'Model', { kind: 'zip', path: '/proj/.anton/artifacts/a4/model.zip', ext: '.zip' }),
];
const shownTitles = () => ['Sales deck', 'Board notes', 'Their report', 'Model'].filter((title) => screen.queryByText(title));

beforeEach(() => { setOrgMode(true); sharing.on = false; localStorage.setItem('anton:artifacts-view', 'list'); });
afterEach(() => { localStorage.clear(); setOrgMode(false); });

describe('ArtifactsView filters', () => {
  it('narrows by type', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    await pickFilter(user, 'Type', 'MD');
    expect(shownTitles()).toEqual(['Board notes']);
  });

  it('narrows by status, in the words the rows use', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    await pickFilter(user, 'Status', 'Shared');
    expect(shownTitles()).toEqual(['Sales deck']);
  });

  it('narrows by owner, naming colleagues, and clears every filter at once', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    await pickFilter(user, 'Owner', 'Bo Chen');
    expect(shownTitles()).toEqual(['Their report']);

    await pickFilter(user, 'Type', 'ZIP');
    expect(shownTitles()).toEqual([]);
    expect(screen.getByText('No artifacts match these filters.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(shownTitles()).toEqual(['Sales deck', 'Board notes', 'Their report', 'Model']);
  });

  it('offers no Owner facet when everything is yours', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ArtifactsView artifacts={ARTIFACTS.filter((a) => a.id !== 'a3')} />);
    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    expect(screen.queryByRole('menuitem', { name: /^Owner/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^Type/ })).toBeInTheDocument();
  });
});
