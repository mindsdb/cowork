/*
 * Live-app sharing on the Live Artifacts page. ArtifactsView builds its menu
 * twice (the list view's `rowMenuItems` and the grid's page-level HoverMenu),
 * so "Let others duplicate…", the page Share it replaces on a live app, and the copy's
 * "received from" line are checked in both views, with live apps on and off.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
  shareLiveApp: vi.fn(),
  fetchLiveAppShares: vi.fn(() => Promise.resolve([])),
  withdrawLiveAppShare: vi.fn(),
  fetchMyLiveApps: vi.fn(() => Promise.resolve(new Map())),
  fetchSharedLiveApps: vi.fn(() => Promise.resolve([])),
  duplicateLiveApp: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: true, isMac: () => false, isElectron: false, openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: toastAdd }) }));
vi.mock('../components/artifact', () => ({ ArtifactViewer: () => null }));

import ArtifactsView from './ArtifactsView';
import { artifactServeUrl, duplicateLiveApp, fetchMyLiveApps, fetchSharedLiveApps, shareLiveApp } from '../api';
import { host } from '../../platform/host';
import { liveAppStatesFrom } from '../lib/liveAppState';
import { setLiveApps } from '../../lib/liveApps';

const app = {
  id: 'a1', slug: 'table-counts', title: 'Table Row Counts',
  type: 'fullstack-stateless-app', ext: '.html', mtime: 2000,
  path: '/proj/.anton/artifacts/table-counts/static/index.html',
  folder: '/proj/.anton/artifacts/table-counts',
  projectId: 'p1', publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
};
const copy = { ...app, id: 'a2', slug: 'orders-2', title: 'Orders Tracker', receivedFrom: { email: 'ana@example.com' } };
const page = { ...app, id: 'a3', slug: 'weekly', title: 'Weekly KPIs', type: 'html-app', path: '/proj/.anton/artifacts/weekly/index.html' };

const openKebab = () => fireEvent.click(screen.getByLabelText('Artifact menu'));
// The page Share item, as both menus label it; not "Let others duplicate…".
const pageShareItem = () => screen.queryByText('Share', { exact: true });

const GENERAL = { id: 'p-general', name: 'general', path: '/general' };
const shared = {
  shareId: 's1', slug: 'pipeline-health', name: 'Pipeline Health', description: '',
  ownerEmail: 'ana@example.com', everyone: false, sharedAt: '2026-10-21T03:00:00Z',
};
const sharedList = () => screen.queryByRole('region', { name: 'Apps you can duplicate' });

afterEach(() => {
  localStorage.clear();
  setLiveApps(false);
  vi.clearAllMocks();
});

describe.each(['grid', 'list'])('%s view', (view) => {
  beforeEach(() => localStorage.setItem('anton:artifacts-view', view));

  describe('with live apps off', () => {
    it('offers no "Let others duplicate…" and shows no "received from" or state line', () => {
      render(<ArtifactsView artifacts={[copy]} />);
      openKebab();
      expect(screen.queryByText('Let others duplicate…')).toBeNull();
      expect(screen.queryByText(/Duplicated from/)).toBeNull();
      expect(screen.queryByText(/^Live at|^Stopped/)).toBeNull();
      expect(fetchMyLiveApps).not.toHaveBeenCalled();
    });

    it('keeps the page Share item and its "Not shared" pill on a full-stack app', () => {
      render(<ArtifactsView artifacts={[app]} />);
      expect(screen.getByText('Not shared')).toBeInTheDocument();
      openKebab();
      expect(pageShareItem()).toBeInTheDocument();
    });
  });

  describe('with live apps on', () => {
    beforeEach(() => setLiveApps(true));

    it('offers "Let others duplicate…" on an owned full-stack app and opens the share dialog', async () => {
      shareLiveApp.mockResolvedValue({ shareId: 's1', slug: 'table-counts', email: 'ben@example.com', sharedAt: 'now' });
      render(<ArtifactsView artifacts={[app]} />);
      openKebab();
      fireEvent.click(screen.getByText('Let others duplicate…'));

      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'ben@example.com' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Allow' }));

      expect(await within(dialog).findByText(/ben@example.com can now duplicate it/)).toBeInTheDocument();
      expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts', email: 'ben@example.com' });
    });

    it('offers no "Let others duplicate…" on a static page', () => {
      render(<ArtifactsView artifacts={[page]} />);
      openKebab();
      expect(screen.queryByText('Let others duplicate…')).toBeNull();
    });

    it('offers no "Let others duplicate…" on an app someone else owns', () => {
      render(<ArtifactsView artifacts={[{ ...app, capabilities: { role: 'reviewer', canEdit: false } }]} />);
      openKebab();
      expect(screen.queryByText('Let others duplicate…')).toBeNull();
    });

    it("shows a live app's state on its card", async () => {
      fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
        { projectId: 'p1', slug: 'table-counts', state: 'running', address: 'http://app1.view.localhost:8080/' },
      ]));
      render(<ArtifactsView artifacts={[app]} />);
      expect(await screen.findByText('Live at app1.view.localhost:8080')).toBeInTheDocument();
    });

    it('drops the page Share item and the "Not shared" pill, which can only mislead on a live app', () => {
      render(<ArtifactsView artifacts={[app]} />);
      expect(screen.queryByText('Not shared')).toBeNull();
      openKebab();
      expect(pageShareItem()).toBeNull();
      expect(screen.getByText('Let others duplicate…')).toBeInTheDocument();
    });

    it('keeps the page Share item and the "Not shared" pill on a static page', () => {
      render(<ArtifactsView artifacts={[page]} />);
      expect(screen.getByText('Not shared')).toBeInTheDocument();
      openKebab();
      expect(pageShareItem()).toBeInTheDocument();
    });

    it('keeps the access badge and "Stop sharing" on a live app published before live apps were on', () => {
      render(<ArtifactsView artifacts={[{ ...app, publishedUrl: 'https://pages.example/a', accessMode: 'public' }]} />);
      expect(screen.getByText('Public')).toBeInTheDocument();
      openKebab();
      expect(screen.getByText('Stop sharing')).toBeInTheDocument();
    });

    it('reads the states again when the app hands down a new list, as after a turn', async () => {
      // The first read knows of no launch; only the second can show the line.
      fetchMyLiveApps.mockResolvedValueOnce(new Map());
      const { rerender } = render(<ArtifactsView artifacts={[app]} />);
      await screen.findByText('Table Row Counts');
      await waitFor(() => expect(fetchMyLiveApps).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/^Live at/)).toBeNull();

      fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
        { projectId: 'p1', slug: 'table-counts', state: 'running', address: 'http://app1.view.localhost:8080/' },
      ]));
      rerender(<ArtifactsView artifacts={[{ ...app }]} />);

      expect(await screen.findByText('Live at app1.view.localhost:8080')).toBeInTheDocument();
      expect(fetchMyLiveApps).toHaveBeenCalledTimes(2);
    });

    it('shows no "received from" line on a card that is not a full-stack app', () => {
      render(<ArtifactsView artifacts={[{ ...page, receivedFrom: { email: 'ana@example.com' } }]} />);
      expect(screen.queryByText(/Duplicated from/)).toBeNull();
    });

    it("shows the copy's \"received from\" line on its card", () => {
      render(<ArtifactsView artifacts={[copy]} />);
      expect(screen.getByText('Duplicated from ana@example.com')).toBeInTheDocument();
    });

    it("offers Launch on a live app that isn't running, which asks the agent in the app's project", async () => {
      fetchMyLiveApps.mockResolvedValue(new Map());
      const onAddressWithAgent = vi.fn(async () => true);
      render(<ArtifactsView artifacts={[app]} onAddressWithAgent={onAddressWithAgent} />);
      await waitFor(() => expect(fetchMyLiveApps).toHaveBeenCalled());
      openKebab();
      fireEvent.click(await screen.findByText('Launch'));

      expect(onAddressWithAgent).toHaveBeenCalledWith({
        artifact: expect.objectContaining({ slug: 'table-counts', projectId: 'p1' }),
        prompt: 'Launch the live app `table-counts`.',
      });
    });

    it('offers no Launch while the app runs, or on a static page', async () => {
      fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
        { projectId: 'p1', slug: 'table-counts', state: 'running', address: 'http://app1.view.localhost:8080/' },
      ]));
      render(<ArtifactsView artifacts={[app, page]} onAddressWithAgent={vi.fn()} />);
      expect(await screen.findByText('Live at app1.view.localhost:8080')).toBeInTheDocument();
      for (const kebab of screen.getAllByLabelText('Artifact menu')) {
        fireEvent.click(kebab);
        expect(screen.queryByText('Launch')).toBeNull();
        fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
      }
    });
  });

  /*
   * The ↗ beside a live app opens the app where it runs. The serve route's
   * copy of its page has no backend, so nothing opens that.
   */
  describe("a live app's ↗", () => {
    const SERVE = 'https://cowork.example/api/v1/artifacts/serve/proj/table-counts/static/index.html';
    const openButton = () => screen.queryByRole('button', { name: 'Open' });
    beforeEach(() => artifactServeUrl.mockReturnValue(SERVE));
    afterEach(() => artifactServeUrl.mockReturnValue(''));

    describe('with live apps on', () => {
      beforeEach(() => setLiveApps(true));

      it("opens a running app's own address", async () => {
        fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
          { projectId: 'p1', slug: 'table-counts', state: 'running', address: 'http://app1.view.localhost:8080/' },
        ]));
        render(<ArtifactsView artifacts={[app]} />);
        await screen.findByText('Live at app1.view.localhost:8080');
        fireEvent.click(openButton());

        await waitFor(() => expect(host.openExternal).toHaveBeenCalledTimes(1));
        expect(host.openExternal).toHaveBeenCalledWith('http://app1.view.localhost:8080/');
      });

      it('shows no ↗ on a stopped app', async () => {
        fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
          { projectId: 'p1', slug: 'table-counts', state: 'stopped', address: 'http://app1.view.localhost:8080/', stopReasonText: 'no requests for 2 h' },
        ]));
        render(<ArtifactsView artifacts={[app]} />);
        await screen.findByText(/^Stopped/);
        expect(openButton()).toBeNull();
      });

      it('shows no ↗ on an app with no launch on record', async () => {
        fetchMyLiveApps.mockResolvedValue(new Map());
        render(<ArtifactsView artifacts={[app]} />);
        await waitFor(() => expect(fetchMyLiveApps).toHaveBeenCalled());
        expect(openButton()).toBeNull();
      });

      it("opens a static page's serve URL, as before", async () => {
        render(<ArtifactsView artifacts={[page]} />);
        fireEvent.click(openButton());
        await waitFor(() => expect(host.openExternal).toHaveBeenCalledWith(SERVE));
      });

      it("opens a published live app's shared page, as before", async () => {
        render(<ArtifactsView artifacts={[{ ...app, publishedUrl: 'https://pages.example/a', accessMode: 'public' }]} />);
        fireEvent.click(openButton());
        await waitFor(() => expect(host.openExternal).toHaveBeenCalledWith('https://pages.example/a'));
      });
    });

    it("opens a full-stack app's serve URL with live apps off, as before", async () => {
      render(<ArtifactsView artifacts={[app]} />);
      fireEvent.click(openButton());
      await waitFor(() => expect(host.openExternal).toHaveBeenCalledWith(SERVE));
    });
  });
});

describe('"Shared with you" on the page', () => {
  // Braces: a function returned from beforeEach runs as its teardown.
  beforeEach(() => { fetchSharedLiveApps.mockResolvedValue([shared]); });

  describe('with live apps off', () => {
    it('shows no list and never asks for one', async () => {
      render(<ArtifactsView artifacts={[]} projects={[GENERAL]} />);
      expect(await screen.findByText('No artifacts yet')).toBeInTheDocument();
      expect(sharedList()).toBeNull();
      expect(fetchSharedLiveApps).not.toHaveBeenCalled();
    });
  });

  describe('with live apps on', () => {
    beforeEach(() => setLiveApps(true));

    it('lists what others shared, with who shared it, before the viewer has any artifacts', async () => {
      render(<ArtifactsView artifacts={[]} projects={[GENERAL]} />);
      const list = await screen.findByRole('region', { name: 'Apps you can duplicate' });
      expect(within(list).getByText('Pipeline Health')).toBeInTheDocument();
      expect(within(list).getByText('From ana@example.com')).toBeInTheDocument();
      expect(within(list).getByRole('button', { name: 'Duplicate Pipeline Health' })).toBeInTheDocument();
      expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    });

    it('offers no second Duplicate once the viewer has a copy', async () => {
      fetchSharedLiveApps.mockResolvedValue([{ ...shared, yourCopy: { projectId: 'p-general', slug: 'pipeline-health-2' } }]);
      render(<ArtifactsView artifacts={[]} projects={[GENERAL]} />);
      const list = await screen.findByRole('region', { name: 'Apps you can duplicate' });
      expect(within(list).getByRole('button', { name: 'You have a copy of Pipeline Health' })).toBeDisabled();
      expect(within(list).queryByRole('button', { name: 'Duplicate Pipeline Health' })).toBeNull();
    });

    it('lists them above the viewer\'s own artifacts too', async () => {
      render(<ArtifactsView artifacts={[app]} projects={[GENERAL]} />);
      const list = await screen.findByRole('region', { name: 'Apps you can duplicate' });
      expect(within(list).getByText('Pipeline Health')).toBeInTheDocument();
      const own = screen.getByText('Table Row Counts');
      expect(list.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows no list while nobody has shared anything', async () => {
      fetchSharedLiveApps.mockResolvedValue([]);
      render(<ArtifactsView artifacts={[]} projects={[GENERAL]} />);
      await waitFor(() => expect(fetchSharedLiveApps).toHaveBeenCalledTimes(1));
      expect(sharedList()).toBeNull();
    });

    it('shows no list without a General project to put the copy in', () => {
      render(<ArtifactsView artifacts={[]} projects={[{ id: 'p1', name: 'demo', path: '/proj' }]} />);
      expect(sharedList()).toBeNull();
      expect(fetchSharedLiveApps).not.toHaveBeenCalled();
    });

    it('copies nothing when the disclaimer is cancelled', async () => {
      const onRefreshArtifacts = vi.fn();
      render(<ArtifactsView artifacts={[]} projects={[GENERAL]} onRefreshArtifacts={onRefreshArtifacts} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(duplicateLiveApp).not.toHaveBeenCalled();
      expect(onRefreshArtifacts).not.toHaveBeenCalled();
      expect(toastAdd).not.toHaveBeenCalled();
    });

    it('says where the copy goes, copies into General on confirm, says it worked, and reads the list again', async () => {
      duplicateLiveApp.mockResolvedValue(copy);
      const onRefreshArtifacts = vi.fn();
      render(<ArtifactsView artifacts={[]} projects={[GENERAL]} onRefreshArtifacts={onRefreshArtifacts} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Pipeline Health' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/ana@example.com lets you duplicate this app\..*Your copy goes to your General project\.$/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

      await waitFor(() => expect(onRefreshArtifacts).toHaveBeenCalledTimes(1));
      expect(duplicateLiveApp).toHaveBeenCalledWith({ shareId: 's1', projectId: 'p-general' });
      expect(toastAdd).toHaveBeenCalledWith({ title: 'Duplicated into your General project.', type: 'success' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
