/*
 * Live-app sharing in the rail: "Let others duplicate…" on an owned full-stack app in the
 * Artifacts card, the "Apps you can duplicate" card under it with Duplicate behind its
 * disclaimer, and the copy's "received from" line. All of it appears only when
 * /health reports live apps; every other deployment renders the rail it did.
 * Rendered through WorkingFolderBox, which holds both cards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../api', () => ({
  fetchActiveProject: vi.fn(() => Promise.resolve(null)),
  fetchArtifacts: vi.fn(() => Promise.resolve([])),
  fetchProjects: vi.fn(() => Promise.resolve([])),
  unpublishArtifact: vi.fn(),
  shareLiveApp: vi.fn(),
  fetchLiveAppShares: vi.fn(() => Promise.resolve([])),
  withdrawLiveAppShare: vi.fn(),
  fetchSharedLiveApps: vi.fn(() => Promise.resolve([])),
  duplicateLiveApp: vi.fn(),
  fetchMyLiveApps: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'https://cowork.example',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('../artifact', () => ({ ArtifactViewer: () => null }));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn(), noteArtifactCreated: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
const toastAdd = vi.fn();
vi.mock('../ui/Toast', () => ({ useToastManager: () => ({ add: toastAdd }) }));

import { WorkingFolderBox } from './WorkingFolderBox';
import { SharedLiveApps } from './SharedLiveApps';
import { duplicateLiveApp, fetchArtifacts, fetchMyLiveApps, fetchSharedLiveApps, shareLiveApp } from '../../api';
import { liveAppStatesFrom } from '../../lib/liveAppState';
import { noteArtifactCreated } from '../../lib/artifactsStore';
import { setLiveApps } from '../../../lib/liveApps';

const PROJECT = { id: 'proj-1', name: 'demo', path: '/proj' };

const app = (overrides = {}) => ({
  id: 'a1',
  slug: 'table-counts',
  title: 'Table Row Counts',
  type: 'fullstack-stateless-app',
  ext: '.html',
  path: '/proj/.anton/artifacts/table-counts/static/index.html',
  projectId: 'proj-1',
  mtime: 2000,
  updated: '5m ago',
  publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
  ...overrides,
});
const page = app({
  id: 'a2', slug: 'weekly', title: 'Weekly KPIs', type: 'html-app',
  path: '/proj/.anton/artifacts/weekly/index.html', mtime: 1000,
});
const copy = app({
  id: 'a3', slug: 'pipeline-health-2', title: 'Pipeline Health',
  path: '/proj/.anton/artifacts/pipeline-health-2/static/index.html', mtime: 3000,
  receivedFrom: { email: 'ana@example.com' },
});
const shared = {
  shareId: 's1', slug: 'pipeline-health', name: 'Pipeline Health', description: '',
  ownerEmail: 'ana@example.com', everyone: false, sharedAt: '2026-10-21T03:00:00Z',
};
// A stop earlier today, so the line carries no date whatever day the suite runs.
const todayAt = (hhmm) => `${new Date().toISOString().slice(0, 10)}T${hhmm}:00Z`;
const refusal = (message, status) => Object.assign(new Error(message), { status });

const renderRail = async (artifacts, { project = PROJECT, isStreaming = false } = {}) => {
  fetchArtifacts.mockResolvedValue(artifacts);
  const view = render(<WorkingFolderBox project={project} isStreaming={isStreaming} />);
  if (artifacts.length) await screen.findByText(artifacts[0].title);
  else await screen.findByText(/No artifacts yet/);
  return view;
};

// Rows render in the server's order; the menu opens from that row's kebab.
const menuOf = async (row) => {
  fireEvent.click(screen.getAllByLabelText('More actions')[row]);
  return screen.findByRole('menu');
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchSharedLiveApps.mockResolvedValue([]);
  fetchMyLiveApps.mockResolvedValue(new Map());
});
afterEach(() => setLiveApps(false));

describe('with live apps off', () => {
  it('renders the rail as before: no share item, no shared list, no received line', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app(), copy]);

    const menu = await menuOf(0);
    expect(within(menu).queryByRole('menuitem', { name: /Share with/ })).toBeNull();
    expect(screen.queryByText('Apps you can duplicate')).toBeNull();
    expect(screen.queryByText(/Received from/)).toBeNull();
    expect(fetchSharedLiveApps).not.toHaveBeenCalled();
    expect(fetchMyLiveApps).not.toHaveBeenCalled();
  });
});

describe('with live apps on', () => {
  beforeEach(() => setLiveApps(true));

  it('offers "Let others duplicate…" on an owned full-stack app', async () => {
    await renderRail([app()]);
    expect(within(await menuOf(0)).getByRole('menuitem', { name: 'Let others duplicate…' })).toBeInTheDocument();
  });

  it.each([
    ['a static page', page],
    ["someone else's app", app({ title: 'Their App', capabilities: { role: 'reviewer', canEdit: false } })],
  ])('offers no "Let others duplicate…" on %s', async (_label, artifact) => {
    await renderRail([artifact]);
    expect(within(await menuOf(0)).queryByRole('menuitem', { name: /Share with/ })).toBeNull();
  });

  it('shares the app with the address typed in the dialog', async () => {
    shareLiveApp.mockResolvedValue({ shareId: 's9', slug: 'table-counts', email: 'ben@example.com', sharedAt: 'now' });
    await renderRail([app()]);

    fireEvent.click(within(await menuOf(0)).getByRole('menuitem', { name: 'Let others duplicate…' }));
    const dialog = await screen.findByRole('dialog');
    const share = within(dialog).getByRole('button', { name: 'Allow' });
    expect(share).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: ' ben@example.com ' } });
    fireEvent.click(share);

    expect(await within(dialog).findByText(/ben@example.com can now duplicate it/)).toBeInTheDocument();
    expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'proj-1', slug: 'table-counts', email: 'ben@example.com' });
  });

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    shareLiveApp.mockRejectedValue(new Error("That's your own address."));
    await renderRail([app()]);

    fireEvent.click(within(await menuOf(0)).getByRole('menuitem', { name: 'Let others duplicate…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'me@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow' }));

    expect(await within(dialog).findByText("That's your own address.")).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("shows a running app's address and a stopped app's reason", async () => {
    fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
      { projectId: 'proj-1', slug: 'table-counts', slot: 1, state: 'running', address: 'http://app1.view.localhost:8080/' },
      {
        projectId: 'proj-1', slug: 'pipeline-health-2', slot: 2, state: 'stopped', address: 'http://app2.view.localhost:8080/',
        stoppedAt: todayAt('12:04'), stopReason: 'idle', stopReasonText: 'no requests for 2 h',
      },
    ]));
    await renderRail([app(), copy]);

    expect(await screen.findByText('Live at app1.view.localhost:8080')).toBeInTheDocument();
    expect(screen.getByText('Stopped 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it.')).toBeInTheDocument();
    expect(screen.getByText('Duplicated from ana@example.com')).toBeInTheDocument();
  });

  it('marks a copy with whom it came from', async () => {
    await renderRail([copy]);
    expect(screen.getByText('Duplicated from ana@example.com')).toBeInTheDocument();
  });

  it('lists what others shared, with who shared it and whether it went to everyone', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared, { ...shared, shareId: 's2', slug: 'orders', name: 'Orders', everyone: true }]);
    await renderRail([app()]);

    const list = await screen.findByRole('region', { name: 'Apps you can duplicate' });
    expect(within(list).getByText('Pipeline Health')).toBeInTheDocument();
    expect(within(list).getByText('From ana@example.com')).toBeInTheDocument();
    expect(within(list).getByText('From ana@example.com · for everyone')).toBeInTheDocument();
  });

  it('puts "Apps you can duplicate" in a card of its own, so the artifact list never scrolls it away', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app()]);

    const list = await screen.findByRole('region', { name: 'Apps you can duplicate' });
    const artifactsCard = screen.getByRole('button', { name: 'Artifacts' }).closest('.rounded-card');
    expect(artifactsCard).not.toContainElement(list);
    expect(within(list.closest('.rounded-card')).getByRole('button', { name: 'Apps you can duplicate' })).toBeInTheDocument();
  });

  it('lists a share and duplicates it in a project with no artifacts yet', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    duplicateLiveApp.mockResolvedValue(copy);
    await renderRail([]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Duplicate' }));

    expect(await screen.findByText('Duplicated from ana@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/No artifacts yet/)).toBeNull();
    expect(duplicateLiveApp).toHaveBeenCalledWith({ shareId: 's1', projectId: 'proj-1' });
  });

  it('reads the list again when a turn starts or ends, so a later share shows up', async () => {
    const { rerender } = await renderRail([app()], { isStreaming: true });
    await waitFor(() => expect(fetchSharedLiveApps).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: 'Apps you can duplicate' })).toBeNull();

    fetchSharedLiveApps.mockResolvedValue([shared]);
    rerender(<WorkingFolderBox project={PROJECT} isStreaming={false} />);

    expect(await screen.findByRole('region', { name: 'Apps you can duplicate' })).toBeInTheDocument();
    expect(fetchSharedLiveApps).toHaveBeenCalledTimes(2);
  });

  it('copies nothing until the disclaimer is confirmed', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Duplicate "Pipeline Health"?')).toBeInTheDocument();
    expect(within(dialog).getByText(/ana@example.com lets you duplicate this app\. Your copy runs with your own connections/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(duplicateLiveApp).not.toHaveBeenCalled();
  });

  it('duplicates into the rail project on confirm, says so, and offers no second copy', async () => {
    const yourCopy = { projectId: 'proj-1', slug: 'pipeline-health-2' };
    fetchSharedLiveApps.mockResolvedValueOnce([shared]).mockResolvedValue([{ ...shared, yourCopy }]);
    duplicateLiveApp.mockResolvedValue(copy);
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Duplicate' }));

    expect(await screen.findByText('Duplicated from ana@example.com')).toBeInTheDocument();
    expect(duplicateLiveApp).toHaveBeenCalledWith({ shareId: 's1', projectId: 'proj-1' });
    expect(noteArtifactCreated).toHaveBeenCalledWith(copy);
    expect(toastAdd).toHaveBeenCalledWith({ title: 'Duplicated into this project.', type: 'success' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'You have a copy of Pipeline Health' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Duplicate Pipeline Health' })).toBeNull();
  });

  it("shows the server's refusal of a second copy and reads the list again", async () => {
    const yourCopy = { projectId: 'proj-1', slug: 'pipeline-health-2' };
    fetchSharedLiveApps.mockResolvedValueOnce([shared]).mockResolvedValue([{ ...shared, yourCopy }]);
    duplicateLiveApp.mockRejectedValue(
      refusal('You already have a copy of this app. Open it, or delete it to duplicate the app again.', 409),
    );
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

    expect(await within(dialog).findByText(/You already have a copy of this app/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'You have a copy of Pipeline Health' })).toBeDisabled();
    expect(noteArtifactCreated).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it("keeps the disclaimer open with the server's refusal", async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    duplicateLiveApp.mockRejectedValue(refusal('Live apps need an email address on your account. Ask the operator to add one.', 403));
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

    expect(await within(dialog).findByText(/Live apps need an email address/)).toBeInTheDocument();
    expect(noteArtifactCreated).not.toHaveBeenCalled();
  });

  it('drops an app that is no longer shared, and still shows why', async () => {
    fetchSharedLiveApps.mockResolvedValueOnce([shared]).mockResolvedValue([]);
    duplicateLiveApp.mockRejectedValue(refusal('You can no longer duplicate this app.', 404));
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

    expect(await within(dialog).findByText('You can no longer duplicate this app.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Apps you can duplicate' })).toBeNull());
    expect(fetchSharedLiveApps).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the server has no shared-apps route', 404],
    ['the sign-in is refused', 401],
  ])('lists nothing, with no error, when %s', async (_label, status) => {
    fetchSharedLiveApps.mockRejectedValue(refusal('refused', status));
    await renderRail([app()]);

    await waitFor(() => expect(fetchSharedLiveApps).toHaveBeenCalled());
    expect(screen.queryByText('Apps you can duplicate')).toBeNull();
    expect(screen.queryByText("Couldn't load the apps you can duplicate.")).toBeNull();
  });

  it('says so when the shared list could not be loaded', async () => {
    fetchSharedLiveApps.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await renderRail([app()]);

    expect(await screen.findByText("Couldn't load the apps you can duplicate.")).toBeInTheDocument();
  });

  it('shows no shared list without a project to copy into', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app()], { project: { name: 'demo', path: '/proj' } });

    expect(screen.queryByText('Apps you can duplicate')).toBeNull();
    expect(fetchSharedLiveApps).not.toHaveBeenCalled();
  });
});

describe('with live apps on: where a copy lands and shows', () => {
  beforeEach(() => setLiveApps(true));

  const duplicateShared = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };
  const artifactsCard = () => screen.getByRole('button', { name: 'Artifacts' }).closest('.rounded-card');

  it('copies into the project on screen, even after a switch with Artifacts collapsed', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    duplicateLiveApp.mockResolvedValue({ ...copy, projectId: 'proj-2' });
    const { rerender } = await renderRail([app()]);

    fireEvent.click(screen.getByRole('button', { name: 'Artifacts' }));
    rerender(<WorkingFolderBox project={{ id: 'proj-2', name: 'other', path: '/other' }} isStreaming={false} />);
    await duplicateShared();

    expect(duplicateLiveApp).toHaveBeenCalledWith({ shareId: 's1', projectId: 'proj-2' });
  });

  it('scrolls the copy into view once, not again each time Artifacts opens', async () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      fetchSharedLiveApps.mockResolvedValue([shared]);
      duplicateLiveApp.mockResolvedValue(copy);
      await renderRail([app()]);
      await duplicateShared();

      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(scroll.mock.contexts[0].dataset.artifactPath).toBe(copy.path);

      fireEvent.click(screen.getByRole('button', { name: 'Artifacts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Artifacts' }));
      await screen.findByText('Table Row Counts');
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("keeps a copy made for another project out of this project's list", async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    duplicateLiveApp.mockResolvedValue({ ...copy, projectId: 'proj-9' });
    await renderRail([app()]);
    await duplicateShared();

    expect(within(artifactsCard()).queryByText('Pipeline Health')).toBeNull();
  });
});

describe('"Apps you can duplicate" over time', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const list = () => screen.queryByRole('region', { name: 'Apps you can duplicate' });

  it('re-reads each minute, so a later share shows up', async () => {
    render(<SharedLiveApps projectId="proj-1" />);
    await tick(0);
    expect(list()).toBeNull();

    fetchSharedLiveApps.mockResolvedValue([shared]);
    await tick(60_000);
    expect(list()).toBeInTheDocument();
  });

  it('keeps the list when a later read fails', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    render(<SharedLiveApps projectId="proj-1" />);
    await tick(0);

    fetchSharedLiveApps.mockRejectedValue(refusal('Bad Gateway', 502));
    await tick(60_000);
    expect(screen.getByRole('button', { name: 'Duplicate Pipeline Health' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the apps you can duplicate.")).toBeNull();
  });

  it('empties the list and stops asking once the server runs no live apps', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    render(<SharedLiveApps projectId="proj-1" />);
    await tick(0);

    fetchSharedLiveApps.mockRejectedValue(refusal('Not Found', 404));
    await tick(60_000);
    expect(list()).toBeNull();
    await tick(180_000);
    expect(fetchSharedLiveApps).toHaveBeenCalledTimes(2);
  });
});
