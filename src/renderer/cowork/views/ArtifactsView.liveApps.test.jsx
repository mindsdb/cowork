// Live-app sharing on the Live Artifacts page. ArtifactsView builds its menu
// twice (the list view's `rowMenuItems` and the grid's page-level HoverMenu),
// so "Share with…" and the copy's "received from" line are checked in both
// views, with live apps on and off.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

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
  fetchMyLiveApps: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: true, isMac: () => false, isElectron: false, openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));
vi.mock('../components/artifact', () => ({ ArtifactViewer: () => null }));

import ArtifactsView from './ArtifactsView';
import { fetchMyLiveApps, shareLiveApp } from '../api';
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

afterEach(() => {
  localStorage.clear();
  setLiveApps(false);
  vi.clearAllMocks();
});

describe.each(['grid', 'list'])('%s view', (view) => {
  beforeEach(() => localStorage.setItem('anton:artifacts-view', view));

  describe('with live apps off', () => {
    it('offers no "Share with…" and shows no "received from" or state line', () => {
      render(<ArtifactsView artifacts={[copy]} />);
      openKebab();
      expect(screen.queryByText('Share with…')).toBeNull();
      expect(screen.queryByText(/Received from/)).toBeNull();
      expect(screen.queryByText(/^Live at|^Stopped/)).toBeNull();
      expect(fetchMyLiveApps).not.toHaveBeenCalled();
    });
  });

  describe('with live apps on', () => {
    beforeEach(() => setLiveApps(true));

    it('offers "Share with…" on an owned full-stack app and opens the share dialog', async () => {
      shareLiveApp.mockResolvedValue({ shareId: 's1', slug: 'table-counts', email: 'ben@example.com', sharedAt: 'now' });
      render(<ArtifactsView artifacts={[app]} />);
      openKebab();
      fireEvent.click(screen.getByText('Share with…'));

      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'ben@example.com' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

      expect(await within(dialog).findByText(/Shared with ben@example.com/)).toBeInTheDocument();
      expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts', email: 'ben@example.com' });
    });

    it('offers no "Share with…" on a static page', () => {
      render(<ArtifactsView artifacts={[page]} />);
      openKebab();
      expect(screen.queryByText('Share with…')).toBeNull();
    });

    it('offers no "Share with…" on an app someone else owns', () => {
      render(<ArtifactsView artifacts={[{ ...app, capabilities: { role: 'reviewer', canEdit: false } }]} />);
      openKebab();
      expect(screen.queryByText('Share with…')).toBeNull();
    });

    it("shows a live app's state on its card", async () => {
      fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([
        { projectId: 'p1', slug: 'table-counts', state: 'running', address: 'http://app1.view.localhost:8080/' },
      ]));
      render(<ArtifactsView artifacts={[app]} />);
      expect(await screen.findByText('Live at app1.view.localhost')).toBeInTheDocument();
    });

    it("shows the copy's \"received from\" line on its card", () => {
      render(<ArtifactsView artifacts={[copy]} />);
      expect(screen.getByText('Received from ana@example.com')).toBeInTheDocument();
    });
  });
});
