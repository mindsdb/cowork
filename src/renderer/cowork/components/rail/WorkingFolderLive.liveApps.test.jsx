/*
 * Live-app sharing in the rail's Artifacts card: "Share with…" on an owned
 * full-stack app, the "Shared with you" list with Duplicate behind its
 * disclaimer, and the copy's "received from" line. All of it appears only when
 * /health reports live apps; every other deployment renders the rail it did.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../api', () => ({
  fetchActiveProject: vi.fn(() => Promise.resolve(null)),
  fetchArtifacts: vi.fn(() => Promise.resolve([])),
  fetchProjects: vi.fn(() => Promise.resolve([])),
  unpublishArtifact: vi.fn(),
  shareLiveApp: vi.fn(),
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

import { WorkingFolderLive } from './WorkingFolderLive';
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
  ownerEmail: 'ana@example.com', sharedAt: '2026-10-21T03:00:00Z',
};

const renderRail = async (artifacts, project = PROJECT) => {
  fetchArtifacts.mockResolvedValue(artifacts);
  render(<WorkingFolderLive project={project} isStreaming={false} />);
  await screen.findByText(artifacts[0].title);
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
    expect(screen.queryByText('Shared with you')).toBeNull();
    expect(screen.queryByText(/Received from/)).toBeNull();
    expect(fetchSharedLiveApps).not.toHaveBeenCalled();
    expect(fetchMyLiveApps).not.toHaveBeenCalled();
  });
});

describe('with live apps on', () => {
  beforeEach(() => setLiveApps(true));

  it('offers "Share with…" on an owned full-stack app', async () => {
    await renderRail([app()]);
    expect(within(await menuOf(0)).getByRole('menuitem', { name: 'Share with…' })).toBeInTheDocument();
  });

  it.each([
    ['a static page', page],
    ["someone else's app", app({ title: 'Their App', capabilities: { role: 'reviewer', canEdit: false } })],
  ])('offers no "Share with…" on %s', async (_label, artifact) => {
    await renderRail([artifact]);
    expect(within(await menuOf(0)).queryByRole('menuitem', { name: /Share with/ })).toBeNull();
  });

  it('shares the app with the address typed in the dialog', async () => {
    shareLiveApp.mockResolvedValue({ shareId: 's9', slug: 'table-counts', email: 'ben@example.com', sharedAt: 'now' });
    await renderRail([app()]);

    fireEvent.click(within(await menuOf(0)).getByRole('menuitem', { name: 'Share with…' }));
    const dialog = await screen.findByRole('dialog');
    const share = within(dialog).getByRole('button', { name: 'Share' });
    expect(share).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: ' ben@example.com ' } });
    fireEvent.click(share);

    expect(await within(dialog).findByText(/Shared with ben@example.com/)).toBeInTheDocument();
    expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'proj-1', slug: 'table-counts', email: 'ben@example.com' });
  });

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    shareLiveApp.mockRejectedValue(new Error("That's your own address."));
    await renderRail([app()]);

    fireEvent.click(within(await menuOf(0)).getByRole('menuitem', { name: 'Share with…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'me@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    expect(await within(dialog).findByText("That's your own address.")).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("shows a running app's address and a stopped app's reason", async () => {
    fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
      { projectId: 'proj-1', slug: 'table-counts', slot: 1, state: 'running', address: 'http://app1.view.localhost:8080/' },
      {
        projectId: 'proj-1', slug: 'pipeline-health-2', slot: 2, state: 'stopped', address: 'http://app2.view.localhost:8080/',
        stoppedAt: '2026-10-21T12:04:00Z', stopReason: 'idle', stopReasonText: 'no requests for 2 h',
      },
    ]));
    await renderRail([app(), copy]);

    expect(await screen.findByText('Live at app1.view.localhost')).toBeInTheDocument();
    expect(screen.getByText('Stopped 12:04, no requests for 2 h. Ask your agent to relaunch it.')).toBeInTheDocument();
    expect(screen.getByText('Received from ana@example.com')).toBeInTheDocument();
  });

  it('marks a copy with whom it came from', async () => {
    await renderRail([copy]);
    expect(screen.getByText('Received from ana@example.com')).toBeInTheDocument();
  });

  it('lists what others shared, with who shared it', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app()]);

    const list = await screen.findByRole('region', { name: 'Shared with you' });
    expect(within(list).getByText('Pipeline Health')).toBeInTheDocument();
    expect(within(list).getByText('From ana@example.com')).toBeInTheDocument();
  });

  it('copies nothing until the disclaimer is confirmed', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Duplicate "Pipeline Health"?')).toBeInTheDocument();
    expect(within(dialog).getByText(/ana@example.com built this app\. Your copy runs with your own connections/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(duplicateLiveApp).not.toHaveBeenCalled();
  });

  it('duplicates into the rail project on confirm and shows the copy', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    duplicateLiveApp.mockResolvedValue(copy);
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Duplicate' }));

    expect(await screen.findByText('Received from ana@example.com')).toBeInTheDocument();
    expect(duplicateLiveApp).toHaveBeenCalledWith({ shareId: 's1', projectId: 'proj-1' });
    expect(noteArtifactCreated).toHaveBeenCalledWith(copy);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("keeps the disclaimer open with the server's refusal", async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    duplicateLiveApp.mockRejectedValue(new Error('This app is no longer shared with you.'));
    await renderRail([app()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

    expect(await within(dialog).findByText('This app is no longer shared with you.')).toBeInTheDocument();
    expect(noteArtifactCreated).not.toHaveBeenCalled();
  });

  it('lists nothing when the server has no shared-apps route', async () => {
    fetchSharedLiveApps.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    await renderRail([app()]);

    await waitFor(() => expect(fetchSharedLiveApps).toHaveBeenCalled());
    expect(screen.queryByText('Shared with you')).toBeNull();
  });

  it('says so when the shared list could not be loaded', async () => {
    fetchSharedLiveApps.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await renderRail([app()]);

    expect(await screen.findByText("Couldn't load the apps shared with you.")).toBeInTheDocument();
  });

  it('shows no shared list without a project to copy into', async () => {
    fetchSharedLiveApps.mockResolvedValue([shared]);
    await renderRail([app()], { name: 'demo', path: '/proj' });

    expect(screen.queryByText('Shared with you')).toBeNull();
    expect(fetchSharedLiveApps).not.toHaveBeenCalled();
  });
});
