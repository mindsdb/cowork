// ENG-4684: an artifact the agent marked `display: "inline"` shows its live
// page in the body of its chat card, under the card's usual head and actions.
// Every other artifact keeps the row card. The frame itself (sandbox, height,
// theme, lazy mount) is ArtifactInlinePreview.test.jsx's business.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const loadHtmlPreview = vi.fn();
vi.mock('../components/artifact/htmlPreviewSource', () => ({
  loadHtmlPreview: (...a) => loadHtmlPreview(...a),
  usesDraftLink: () => false,
  withdrawDraftLinks: vi.fn(async () => false),
}));

const deleted = vi.fn(() => false);
vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: (card, opts) => deleted(card, opts),
  useArtifactCardBySlug: () => null,
  setArtifactsScope: vi.fn(),
  revalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => true,
    getPlatform: () => 'darwin',
    getApiOrigin: () => 'http://127.0.0.1:26866',
    isLocalApiOrigin: () => true,
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: true,
  isWeb: false,
}));

import { ArtifactCard, artifactStepToCard } from './ChatView';

const step = (overrides = {}) => ({
  id: 'artifact-revenue',
  label: 'Revenue by month',
  badge: 'Artifact',
  status: 'completed',
  data: {
    title: 'Revenue by month',
    file_path: '/proj/.anton/artifacts/revenue/index.html',
    path: '/proj/.anton/artifacts/revenue/index.html',
    ext: '.html',
    action: 'html-app',
    slug: 'revenue',
    ...overrides,
  },
});

const card = (overrides) => artifactStepToCard(step(overrides), '/proj');

// Every observed card is in view at once: the lazy mount is tested with
// the preview itself.
class InViewObserver {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', InViewObserver);
  deleted.mockReturnValue(false);
  loadHtmlPreview.mockResolvedValue({ kind: 'static', url: '', doc: '<p>chart</p>', port: null, expiresAt: null });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('ArtifactCard inline mode', () => {
  it('shows the live page inside the card for an inline HTML artifact, keeping its actions', async () => {
    const onOpen = vi.fn();
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={onOpen} />);

    const frame = await screen.findByTitle('Revenue by month');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    // A group around a live page, not a button.
    expect(screen.getByRole('group', { name: 'Revenue by month' })).toBeInTheDocument();

    // Preview still opens it full size in the viewer.
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revenue by month', display: 'inline' }));
  });

  it('reads the flag nested under metadata too', async () => {
    render(<ArtifactCard artifact={card({ metadata: { display: 'inline' } })} onOpen={vi.fn()} />);
    expect(await screen.findByTitle('Revenue by month')).toBeInTheDocument();
  });

  it('keeps the row card for an artifact without the flag', async () => {
    render(<ArtifactCard artifact={card()} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Revenue by month/ })).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
    await waitFor(() => expect(loadHtmlPreview).not.toHaveBeenCalled());
  });

  it('keeps the row card for an inline artifact that is not an HTML page', () => {
    render(<ArtifactCard
      artifact={card({ display: 'inline', file_path: '/proj/.anton/artifacts/revenue/data.csv', path: '/proj/.anton/artifacts/revenue/data.csv', ext: '.csv' })}
      onOpen={vi.fn()}
    />);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
  });

  it('keeps the row card for an inline fullstack app, which needs the viewer', () => {
    render(<ArtifactCard artifact={card({ display: 'inline', type: 'fullstack-stateless-app' })} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
  });

  it('shows no live page for a deleted artifact', () => {
    deleted.mockReturnValue(true);
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
  });
});
